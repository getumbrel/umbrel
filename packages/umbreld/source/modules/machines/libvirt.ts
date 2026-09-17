import fsp from 'node:fs/promises'
import nodePath from 'node:path'

import {execa} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import type Umbreld from '../../index.js'
import {
	buildDomainXml,
	MACHINE_NETWORK_NAME,
	machineDiskTarget,
	type MachineArchitecture,
	type MachineDefinition,
	resolveAcceleration,
} from './domain.js'
import {
	buildMachineNetworkXml,
	buildMachinePortForwardNftables,
	dhcpHostXml,
	MACHINE_GUEST_HOST_ADDRESS,
	MACHINE_NETWORK_BRIDGE,
	machineDnsServersFromResolvConf,
	machineDhcpLeases,
	parseActiveMachineLeaseAddresses,
	parseMachineDhcpLeases,
} from './machine-network.js'
import {
	installCommandOptions,
	MACHINE_INSTALL_COMMAND_TIMEOUT_MS,
	MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS,
} from './install-command.js'

export {MACHINE_GUEST_HOST_ADDRESS} from './machine-network.js'

const LIBVIRT_URI = 'qemu:///system'
const LIBVIRT_SWTPM_STATE_ROOT = '/var/lib/libvirt/swtpm'
const GPU_RENDER_NODE_ROOT = '/dev/dri'
const VIRGL_LINUX_FAMILIES = new Set(['ubuntu', 'fedora', 'debian', 'android', 'omarchy'])
const AUDIO_CARD_INDEX_START = 8
const AUDIO_CARD_COUNT = 8
const AUDIO_SUBSTREAMS_PER_CARD = 8
const AUDIO_SLOT_COUNT = AUDIO_CARD_COUNT * AUDIO_SUBSTREAMS_PER_CARD
export const MACHINE_SHORT_CONTROL_TIMEOUT_MS = 30_000
export const QEMU_GIBIBYTE_BYTES = 1_024 ** 3
const MOUNTPOINT_NOT_MOUNTED_EXIT_CODE = 32

export function audioDevicesForSlot(slot: number) {
	if (!Number.isInteger(slot) || slot < 0 || slot >= AUDIO_SLOT_COUNT) throw new Error('[machine-audio-slot-invalid]')
	const card = Math.floor(slot / AUDIO_SUBSTREAMS_PER_CARD)
	const substream = slot % AUDIO_SUBSTREAMS_PER_CARD
	const cardIndex = AUDIO_CARD_INDEX_START + card
	return {
		cardIndex,
		playback: `hw:${cardIndex},0,${substream}`,
		capture: `hw:${cardIndex},1,${substream}`,
		playbackStatus: `/proc/asound/card${cardIndex}/pcm0p/sub${substream}/status`,
	}
}

const FIRMWARE = {
	amd64: {
		code: ['/usr/share/OVMF/OVMF_CODE_4M.fd', '/usr/share/OVMF/OVMF_CODE.fd'],
		vars: ['/usr/share/OVMF/OVMF_VARS_4M.fd', '/usr/share/OVMF/OVMF_VARS.fd'],
		secureCode: ['/usr/share/OVMF/OVMF_CODE_4M.ms.fd', '/usr/share/OVMF/OVMF_CODE.ms.fd'],
		secureVars: ['/usr/share/OVMF/OVMF_VARS_4M.ms.fd', '/usr/share/OVMF/OVMF_VARS.ms.fd'],
	},
	arm64: {
		code: ['/usr/share/AAVMF/AAVMF_CODE.fd', '/usr/share/qemu-efi-aarch64/QEMU_EFI.fd'],
		vars: ['/usr/share/AAVMF/AAVMF_VARS.fd', '/usr/share/qemu-efi-aarch64/vars-template-pflash.raw'],
		secureCode: ['/usr/share/AAVMF/AAVMF_CODE.ms.fd', '/usr/share/AAVMF/AAVMF_CODE.secboot.fd'],
		secureVars: ['/usr/share/AAVMF/AAVMF_VARS.ms.fd'],
	},
} as const

async function firstExisting(paths: readonly string[]) {
	for (const path of paths) if (await fse.pathExists(path)) return path
	throw new Error(`[machine-firmware-unavailable] ${paths.join(', ')}`)
}

export async function findGpuRenderNode(root = GPU_RENDER_NODE_ROOT) {
	const entries = await fsp.readdir(root, {withFileTypes: true}).catch(() => [])
	const candidates = entries
		.map((entry) => entry.name)
		.filter((name) => /^renderD\d+$/.test(name))
		.sort((a, b) => a.localeCompare(b, undefined, {numeric: true}))

	for (const name of candidates) {
		const path = nodePath.join(root, name)
		if (
			await fsp
				.stat(path)
				.then((stat) => stat.isCharacterDevice())
				.catch(() => false)
		) {
			return path
		}
	}
	return undefined
}

export function supportsVirglGraphics(definition: MachineDefinition) {
	return (
		(definition.osVariant === 'Desktop' || definition.osId === 'android' || definition.osId === 'omarchy') &&
		VIRGL_LINUX_FAMILIES.has(definition.osId) &&
		(definition.platformProfile === 'modern-x86' || definition.platformProfile === 'modern-arm64')
	)
}

export async function createWithGraphicsFallback(
	renderNode: string | undefined,
	create: (renderNode?: string) => Promise<void>,
	onFallback: (error: unknown) => void,
) {
	if (!renderNode) return create()
	try {
		await create(renderNode)
	} catch (error) {
		onFallback(error)
		await create()
	}
}

export type DomainState = 'running' | 'paused' | 'suspended' | 'stopped'

export function isMissingDomainError(output: string) {
	return /\bdomain not found\b|\bno domain with matching name\b|^error:\s*failed to get domain\s+['"][^'"]+['"]\s*$/i.test(
		output,
	)
}

export type DomainResourceStats = {
	id: string
	cpuTimeNs: number
	memoryBytes: number
}

type DefaultRoute = {dev?: string; metric?: number}

export function parseDomainResourceStats(output: string): DomainResourceStats[] {
	const result: DomainResourceStats[] = []
	for (const block of output.split(/\n\s*\n/)) {
		const name = /^Domain:\s+'umbrel-machine-([^']+)'$/m.exec(block)?.[1]
		if (!name) continue
		const cpuTimeNs = Number(/^\s*cpu\.time=(\d+)$/m.exec(block)?.[1] ?? 0)
		const memoryKiB = Number(/^\s*balloon\.rss=(\d+)$/m.exec(block)?.[1] ?? 0)
		result.push({
			id: name,
			cpuTimeNs: Number.isFinite(cpuTimeNs) ? cpuTimeNs : 0,
			memoryBytes: Number.isFinite(memoryKiB) ? memoryKiB * 1024 : 0,
		})
	}
	return result
}

export function parseQemuImgProgress(output: string) {
	const matches = [...output.matchAll(/\((\d+(?:\.\d+)?)\/100%\)/g)]
	return matches.length ? Number(matches.at(-1)![1]) : undefined
}

export type QemuImageFormat = 'qcow2' | 'raw' | 'vmdk' | 'vdi' | 'vhdx' | 'vpc'

export function qemuImageFormatForPath(path: string): QemuImageFormat {
	const extension = nodePath.extname(path).toLowerCase()
	if (extension === '.qcow2') return 'qcow2'
	if (extension === '.img') return 'raw'
	if (extension === '.vmdk') return 'vmdk'
	if (extension === '.vdi') return 'vdi'
	if (extension === '.vhdx') return 'vhdx'
	if (extension === '.vhd') return 'vpc'
	throw new Error('[machine-image-format-unsupported]')
}

export function qemuImageInfoArguments(source: string, inputFormat: QemuImageFormat) {
	return ['info', '-f', inputFormat, '--output=json', source]
}

export function qemuImageConvertArguments(source: string, destination: string, inputFormat: QemuImageFormat) {
	return ['convert', '-p', '-f', inputFormat, '-O', 'qcow2', source, destination]
}

const WINDOWS_98_PARTITION_OFFSET_SECTORS = 2_048

function lbaToChs(lba: number) {
	const sectorsPerTrack = 63
	const heads = 255
	const cylinder = Math.floor(lba / (heads * sectorsPerTrack))
	if (cylinder > 1_023) return Buffer.from([0xfe, 0xff, 0xff])
	const trackOffset = lba % (heads * sectorsPerTrack)
	const head = Math.floor(trackOffset / sectorsPerTrack)
	const sector = (trackOffset % sectorsPerTrack) + 1
	return Buffer.from([head, sector | ((cylinder >> 2) & 0xc0), cylinder & 0xff])
}

export function buildWindows98Mbr(diskSizeBytes: number) {
	const totalSectors = Math.floor(diskSizeBytes / 512)
	const partitionSectors = totalSectors - WINDOWS_98_PARTITION_OFFSET_SECTORS
	if (partitionSectors <= 0 || partitionSectors > 0xffffffff) {
		throw new Error('[machine-windows-98-disk-size-unsupported]')
	}

	const mbr = Buffer.alloc(512)
	const partition = 446
	mbr[partition] = 0x80 // Active/bootable
	lbaToChs(WINDOWS_98_PARTITION_OFFSET_SECTORS).copy(mbr, partition + 1)
	mbr[partition + 4] = 0x0c // FAT32 with LBA addressing
	lbaToChs(WINDOWS_98_PARTITION_OFFSET_SECTORS + partitionSectors - 1).copy(mbr, partition + 5)
	mbr.writeUInt32LE(WINDOWS_98_PARTITION_OFFSET_SECTORS, partition + 8)
	mbr.writeUInt32LE(partitionSectors, partition + 12)
	mbr[510] = 0x55
	mbr[511] = 0xaa
	return mbr
}

export default class Libvirt {
	#runtimeRoot: string
	#audioQueue = new PQueue({concurrency: 1})
	#networkQueue = new PQueue({concurrency: 1})
	#nextFirewallCheckAt = 0
	logger: Umbreld['logger']
	available = false
	kvmAvailable = false

	constructor(umbreld: Umbreld) {
		this.#runtimeRoot = process.env.UMBREL_MACHINES_RUNTIME_DIR || '/run/umbrel-machines'
		this.logger = umbreld.logger.createChildLogger('libvirt')
	}

	async probe() {
		this.kvmAvailable = await fse
			.stat('/dev/kvm')
			.then((stat) => stat.isCharacterDevice())
			.catch(() => false)
		try {
			await execa('qemu-img', ['--version'], {timeout: 10_000})
			// The socket is ordered before umbreld, but its first activation still
			// has to spawn libvirtd. Retry that transient handshake so a single
			// early connection failure does not disable Machines for the whole boot.
			await pRetry(() => execa('virsh', ['--connect', LIBVIRT_URI, 'version'], {timeout: 10_000}), {
				retries: 5,
				minTimeout: 500,
				maxTimeout: 1_000,
			})
			this.available = true
		} catch (error) {
			this.available = false
			this.logger.log(`Virtualization is unavailable: ${error instanceof Error ? error.message : error}`)
		}
		return {available: this.available, kvmAvailable: this.kvmAvailable}
	}

	domainName(id: string) {
		return `umbrel-machine-${id}`
	}

	runtimeDirectory(id: string) {
		return nodePath.join(this.#runtimeRoot, id)
	}

	#networkXmlPath() {
		return nodePath.join(this.#runtimeRoot, 'network.xml')
	}

	async #networkExists() {
		const result = await execa('virsh', ['--connect', LIBVIRT_URI, 'net-info', MACHINE_NETWORK_NAME], {
			reject: false,
			timeout: 10_000,
		})
		return result.exitCode === 0
	}

	async #updateDhcpLease(command: 'add-last' | 'delete', lease: ReturnType<typeof machineDhcpLeases>[number]) {
		const path = nodePath.join(this.#runtimeRoot, `.dhcp-${process.pid}-${Date.now()}-${Math.random()}.xml`)
		try {
			await fsp.writeFile(path, dhcpHostXml(lease), {encoding: 'utf8', mode: 0o600})
			await execa(
				'virsh',
				[
					'--connect',
					LIBVIRT_URI,
					'net-update',
					MACHINE_NETWORK_NAME,
					command,
					'ip-dhcp-host',
					'--xml',
					path,
					'--live',
				],
				{timeout: 10_000},
			)
		} finally {
			await fse.remove(path)
		}
	}

	async #reconcileNetworkUnlocked(definitions: MachineDefinition[]) {
		await fse.ensureDir(this.#runtimeRoot)
		if (!(await this.#networkExists())) {
			const resolvConf = await fsp.readFile('/etc/resolv.conf', 'utf8').catch(() => '')
			const dnsServers = machineDnsServersFromResolvConf(resolvConf)
			await fsp.writeFile(this.#networkXmlPath(), buildMachineNetworkXml(definitions, dnsServers), {
				encoding: 'utf8',
				mode: 0o600,
			})
			await execa('virsh', ['--connect', LIBVIRT_URI, 'net-create', this.#networkXmlPath()], {timeout: 30_000})
			return
		}

		const {stdout: xml} = await execa('virsh', ['--connect', LIBVIRT_URI, 'net-dumpxml', MACHINE_NETWORK_NAME], {
			timeout: 10_000,
		})
		if (
			!xml.includes(`<bridge name='${MACHINE_NETWORK_BRIDGE}'`) ||
			!xml.includes(`address='${MACHINE_GUEST_HOST_ADDRESS}'`)
		) {
			throw new Error('[machine-network-incompatible]')
		}
		const current = new Map(parseMachineDhcpLeases(xml).map((lease) => [lease.macAddress, lease]))
		const desired = new Map(machineDhcpLeases(definitions).map((lease) => [lease.macAddress, lease]))
		for (const [macAddress, lease] of current) {
			const target = desired.get(macAddress)
			if (target && target.ipAddress === lease.ipAddress && target.name === lease.name) continue
			await this.#updateDhcpLease('delete', lease)
		}
		for (const [macAddress, lease] of desired) {
			const existing = current.get(macAddress)
			if (existing && existing.ipAddress === lease.ipAddress && existing.name === lease.name) continue
			await this.#updateDhcpLease('add-last', lease)
		}
	}

	async #lanInterface() {
		const {stdout} = await execa('ip', ['-json', 'route', 'show', 'default'])
		const routes = JSON.parse(stdout) as DefaultRoute[]
		return routes.sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0)).find((route) => route.dev)?.dev
	}

	async #reconcileFirewallUnlocked(definitions: MachineDefinition[]) {
		const forwards = definitions.flatMap((definition) =>
			definition.portForwards.map((forward) => ({...forward, ipAddress: definition.ipAddress!})),
		)
		const needsLan = forwards.length > 0
		const lanInterface = needsLan ? await this.#lanInterface() : undefined
		if (needsLan && !lanInterface) throw new Error('[machine-lan-interface-unavailable]')

		await execa('nft', ['delete', 'table', 'ip', 'umbrel_machines'], {reject: false, timeout: 10_000})
		await execa('nft', ['-f', '-'], {
			input: buildMachinePortForwardNftables(definitions, lanInterface),
			timeout: 10_000,
		})

		await this.#removeManagedNftRules('filter', 'DOCKER-USER')
		await this.#removeManagedNftRules('libvirt_network', 'guest_input')
		await this.#removeManagedNftRules('libvirt_network', 'guest_cross')
		for (const rule of [
			`iifname ${JSON.stringify(MACHINE_NETWORK_BRIDGE)} counter accept comment "umbrel-machines"`,
			`oifname ${JSON.stringify(MACHINE_NETWORK_BRIDGE)} ct state related,established counter accept comment "umbrel-machines"`,
			`oifname ${JSON.stringify(MACHINE_NETWORK_BRIDGE)} ct status dnat counter accept comment "umbrel-machines"`,
		]) {
			await execa('nft', ['insert', 'rule', 'ip', 'filter', 'DOCKER-USER', ...rule.split(' ')], {timeout: 10_000})
		}
		await execa(
			'nft',
			[
				'insert',
				'rule',
				'ip',
				'libvirt_network',
				'guest_input',
				'oifname',
				MACHINE_NETWORK_BRIDGE,
				'ct',
				'status',
				'dnat',
				'counter',
				'accept',
				'comment',
				'"umbrel-machines"',
			],
			{timeout: 10_000},
		)
		await execa(
			'nft',
			[
				'insert',
				'rule',
				'ip',
				'libvirt_network',
				'guest_cross',
				'iifname',
				MACHINE_NETWORK_BRIDGE,
				'oifname',
				MACHINE_NETWORK_BRIDGE,
				'counter',
				'reject',
				'comment',
				'"umbrel-machines"',
			],
			{timeout: 10_000},
		)
		this.#nextFirewallCheckAt = Date.now() + 5_000
	}

	async #removeManagedNftRules(table: string, chain: string) {
		const current = await execa('nft', ['-a', 'list', 'chain', 'ip', table, chain], {reject: false, timeout: 10_000})
		for (const match of current.stdout.matchAll(/comment "umbrel-machines"[^\n]*# handle (\d+)/g)) {
			await execa('nft', ['delete', 'rule', 'ip', table, chain, 'handle', match[1]], {timeout: 10_000})
		}
	}

	async reconcileNetwork(definitions: MachineDefinition[]) {
		await this.#networkQueue.add(async () => {
			await this.#reconcileNetworkUnlocked(definitions)
			await this.#reconcileFirewallUnlocked(definitions)
		})
	}

	async leasedIpAddresses() {
		if (!this.available || !(await this.#networkExists())) return []
		const result = await execa('virsh', ['--connect', LIBVIRT_URI, 'net-dhcp-leases', MACHINE_NETWORK_NAME], {
			reject: false,
			timeout: 10_000,
		})
		return result.exitCode === 0 ? parseActiveMachineLeaseAddresses(result.stdout) : []
	}

	async reconcileFirewall(definitions: MachineDefinition[]) {
		await this.#networkQueue.add(() => this.#reconcileFirewallUnlocked(definitions))
	}

	async ensureFirewall(definitions: MachineDefinition[]) {
		if (Date.now() < this.#nextFirewallCheckAt) return
		await this.#networkQueue.add(async () => {
			if (Date.now() < this.#nextFirewallCheckAt) return
			const [natTable, dockerUser, libvirtInput, libvirtCross] = await Promise.all([
				execa('nft', ['list', 'table', 'ip', 'umbrel_machines'], {reject: false, timeout: 10_000}),
				execa('nft', ['list', 'chain', 'ip', 'filter', 'DOCKER-USER'], {reject: false, timeout: 10_000}),
				execa('nft', ['list', 'chain', 'ip', 'libvirt_network', 'guest_input'], {
					reject: false,
					timeout: 10_000,
				}),
				execa('nft', ['list', 'chain', 'ip', 'libvirt_network', 'guest_cross'], {
					reject: false,
					timeout: 10_000,
				}),
			])
			if (
				natTable.exitCode !== 0 ||
				(dockerUser.stdout.match(/comment "umbrel-machines"/g)?.length ?? 0) !== 3 ||
				(libvirtInput.stdout.match(/comment "umbrel-machines"/g)?.length ?? 0) !== 1 ||
				(libvirtCross.stdout.match(/comment "umbrel-machines"/g)?.length ?? 0) !== 1
			) {
				await this.#reconcileFirewallUnlocked(definitions)
				return
			}
			this.#nextFirewallCheckAt = Date.now() + 5_000
		})
	}

	async cleanupNetwork() {
		await this.#networkQueue.add(async () => {
			await execa('nft', ['delete', 'table', 'ip', 'umbrel_machines'], {reject: false, timeout: 10_000})
			await this.#removeManagedNftRules('filter', 'DOCKER-USER')
			await this.#removeManagedNftRules('libvirt_network', 'guest_input')
			await this.#removeManagedNftRules('libvirt_network', 'guest_cross')
			await execa('virsh', ['--connect', LIBVIRT_URI, 'net-destroy', MACHINE_NETWORK_NAME], {
				reject: false,
				timeout: 10_000,
			})
			await fse.remove(this.#networkXmlPath())
		})
	}

	displaySocket(id: string) {
		return nodePath.join(this.runtimeDirectory(id), 'display.sock')
	}

	#audioSlotPath(id: string) {
		return nodePath.join(this.runtimeDirectory(id), 'audio-slot')
	}

	async #allocateAudio(id: string) {
		return this.#audioQueue.add(async () => {
			const entries = await fsp.readdir(this.#runtimeRoot, {withFileTypes: true}).catch(() => [])
			const used = new Map<number, string>()
			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				const value = await fsp.readFile(this.#audioSlotPath(entry.name), 'utf8').catch(() => '')
				if (!/^\d+$/.test(value.trim())) continue
				const slot = Number(value.trim())
				if (Number.isInteger(slot) && slot >= 0 && slot < AUDIO_SLOT_COUNT) used.set(slot, entry.name)
			}

			for (let slot = 0; slot < AUDIO_SLOT_COUNT; slot++) {
				if (used.has(slot)) continue
				const devices = audioDevicesForSlot(slot)
				if (!(await fse.pathExists(`/dev/snd/pcmC${devices.cardIndex}D0p`))) continue
				await fsp.writeFile(this.#audioSlotPath(id), String(slot), {encoding: 'utf8', mode: 0o600})
				return devices
			}

			// A guest can power itself off without going through stop(). Reclaim only
			// slots whose transient libvirt domain has definitely stopped.
			for (const [slot, machineId] of used) {
				if ((await this.state(machineId)) !== 'stopped') continue
				await fse.remove(this.#audioSlotPath(machineId))
				const devices = audioDevicesForSlot(slot)
				if (!(await fse.pathExists(`/dev/snd/pcmC${devices.cardIndex}D0p`))) continue
				await fsp.writeFile(this.#audioSlotPath(id), String(slot), {encoding: 'utf8', mode: 0o600})
				return devices
			}

			this.logger.log(`No host audio loopback slot is available for ${id}; starting without audio`)
			return undefined
		})
	}

	async #releaseAudio(id: string) {
		await this.#audioQueue.add(() => fse.remove(this.#audioSlotPath(id)))
	}

	async audioCaptureSource(id: string) {
		if ((await this.state(id)) !== 'running') throw new Error('[machine-not-running]')
		const value = (await fsp.readFile(this.#audioSlotPath(id), 'utf8').catch(() => '')).trim()
		if (!/^\d+$/.test(value)) throw new Error('[machine-audio-unavailable]')
		const slot = Number(value)
		const devices = audioDevicesForSlot(slot)
		if (
			!(await fse.pathExists(`/dev/snd/pcmC${devices.cardIndex}D1c`)) ||
			!(await fse.pathExists(devices.playbackStatus))
		) {
			throw new Error('[machine-audio-unavailable]')
		}
		return {device: devices.capture, playbackStatus: devices.playbackStatus}
	}

	storageDirectory(id: string) {
		return nodePath.join(this.runtimeDirectory(id), 'storage')
	}

	#externalDiskMount(id: string) {
		return nodePath.join(this.runtimeDirectory(id), 'external-disk.qcow2')
	}

	async #unmount(path: string) {
		const result = await execa('umount', ['--lazy', path], {
			reject: false,
			timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS,
		})
		if (result.exitCode === 0) return
		const exists = await fsp
			.lstat(path)
			.then(() => true)
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code === 'ENOENT') return false
				throw error
			})
		if (!exists) return

		// umount also fails when the path is already detached. Confirm that case
		// before allowing callers to remove the runtime directory; any real mount
		// failure must preserve it so we never delete through a live bind mount.
		const mountpoint = await execa('mountpoint', ['--quiet', path], {
			reject: false,
			timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS,
		})
		// util-linux reserves 32 for an existing path that is not a mountpoint.
		// Exit code 1 is an operational error (including a failed stat), so it must
		// not be mistaken for proof that the bind mount was detached.
		if (mountpoint.exitCode === MOUNTPOINT_NOT_MOUNTED_EXIT_CODE) return
		throw new Error(`[machine-runtime-unmount-failed] ${path}`)
	}

	async #unmountExternalDisk(id: string) {
		await this.#unmount(this.#externalDiskMount(id))
	}

	#tpmMountMarker(id: string) {
		return nodePath.join(this.runtimeDirectory(id), 'tpm-uuid')
	}

	#tpmRuntimeDirectory(uuid: string) {
		return nodePath.join(LIBVIRT_SWTPM_STATE_ROOT, uuid, 'tpm2')
	}

	async #unmountStorage(id: string) {
		await this.#unmount(this.storageDirectory(id))
	}

	async #unmountTpm(id: string) {
		const marker = await fsp.readFile(this.#tpmMountMarker(id), 'utf8').catch(() => '')
		const uuid = marker.trim()
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return
		await this.#unmount(this.#tpmRuntimeDirectory(uuid))
		await fse.remove(nodePath.join(LIBVIRT_SWTPM_STATE_ROOT, uuid))
	}

	async cleanupRuntime(id: string) {
		await this.#releaseAudio(id)
		await this.#unmountTpm(id)
		await this.#unmountExternalDisk(id)
		await this.#unmountStorage(id)
		await fse.remove(this.runtimeDirectory(id))
	}

	async firmware(arch: MachineArchitecture, secureBoot = false) {
		if (secureBoot) {
			return {
				code: await firstExisting(FIRMWARE[arch].secureCode),
				vars: await firstExisting(FIRMWARE[arch].secureVars),
			}
		}
		return {
			code: await firstExisting(FIRMWARE[arch].code),
			vars: await firstExisting(FIRMWARE[arch].vars),
		}
	}

	async initializeNvram(definition: MachineDefinition, machineDirectory: string, signal?: AbortSignal) {
		if (signal?.aborted) throw signal.reason
		if (definition.firmware !== 'uefi') return
		const {vars} = await this.firmware(definition.arch, definition.secureBoot)
		await fse.copy(vars, nodePath.join(machineDirectory, 'nvram.fd'), {overwrite: false})
		if (signal?.aborted) throw signal.reason
		if (definition.tpm) await this.#prepareTpm(machineDirectory, signal)
	}

	async #prepareTpm(machineDirectory: string, signal?: AbortSignal) {
		const tpm = nodePath.join(machineDirectory, 'tpm')
		await fse.ensureDir(tpm)
		// swtpm runs as tss. Reapply ownership on every start so TPM state restored
		// from an Umbrel data backup remains usable even if numeric UIDs changed.
		const commandOptions = signal ? installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS) : undefined
		await execa('chown', ['-R', 'tss:tss', tpm], commandOptions)
		await execa('chmod', ['-R', 'u+rwX,go-rwx', tpm], commandOptions)
	}

	async #mountTpm(definition: MachineDefinition, machineDirectory: string) {
		await this.#prepareTpm(machineDirectory)
		const persistent = nodePath.join(machineDirectory, 'tpm')
		const runtime = this.#tpmRuntimeDirectory(definition.uuid)
		// Libvirt's generated AppArmor policy only grants swtpm access to this
		// canonical path. A lifetime-scoped bind mount keeps the real state in the
		// portable Umbrel machine directory without weakening that policy.
		await fse.ensureDir(runtime)
		await execa('chown', ['-R', 'tss:tss', nodePath.dirname(runtime)])
		await execa('chmod', ['0700', nodePath.dirname(runtime), runtime])
		await fsp.writeFile(this.#tpmMountMarker(definition.id), definition.uuid, {encoding: 'utf8', mode: 0o600})
		await execa('mount', ['--bind', persistent, runtime])
	}

	async start(definition: MachineDefinition, machineDirectory: string, diskPath: string) {
		if (!this.available) throw new Error('[virtualization-unavailable]')
		if ((await this.state(definition.id)) !== 'stopped') throw new Error('[machine-not-stopped]')

		const runtimeDirectory = this.runtimeDirectory(definition.id)
		await this.cleanupRuntime(definition.id)
		await fse.ensureDir(runtimeDirectory)
		await execa('chown', ['libvirt-qemu:libvirt-qemu', runtimeDirectory])
		await fsp.chmod(runtimeDirectory, 0o750)
		const storageDirectory = this.storageDirectory(definition.id)
		await fse.ensureDir(storageDirectory)
		await execa('mount', ['--bind', machineDirectory, storageDirectory])
		let runtimeDiskPath = nodePath.join(storageDirectory, 'disk.qcow2')
		if (definition.diskPath) {
			runtimeDiskPath = this.#externalDiskMount(definition.id)
			await fsp.writeFile(runtimeDiskPath, '', {mode: 0o660})
			// Newly converted external disks are owned by umbreld. Give libvirt's
			// unprivileged QEMU user access when the filesystem supports Unix DAC;
			// filesystems such as SMB may reject these metadata operations while
			// still permitting writes through their mount credentials.
			await execa('chown', ['libvirt-qemu:libvirt-qemu', diskPath], {reject: false})
			await execa('chmod', ['0660', diskPath], {reject: false})
			await execa('mount', ['--bind', diskPath, runtimeDiskPath])
		}

		try {
			if (definition.tpm) await this.#mountTpm(definition, machineDirectory)
			const audio = await this.#allocateAudio(definition.id)
			const acceleration = resolveAcceleration(definition.arch, this.kvmAvailable)
			// Render nodes are host runtime state, not part of the portable machine
			// definition. Discover one for every start so a restored machine can move
			// freely between GPU-equipped and headless Umbrel hardware.
			const graphicsRenderNode = supportsVirglGraphics(definition) ? await findGpuRenderNode() : undefined
			const firmwareCode =
				definition.firmware === 'uefi' ? (await this.firmware(definition.arch, definition.secureBoot)).code : undefined
			const xmlPath = nodePath.join(runtimeDirectory, 'domain.xml')
			const create = async (renderNode?: string) => {
				const xml = buildDomainXml({
					definition,
					machineDirectory: storageDirectory,
					diskPath: runtimeDiskPath,
					runtimeDirectory,
					acceleration,
					firmwareCode,
					graphicsRenderNode: renderNode,
					audioPlaybackDevice: audio?.playback,
				})
				await fsp.writeFile(xmlPath, xml, {encoding: 'utf8', mode: 0o600})
				// A rapid destroy/create can briefly race systemd removing libvirt's old
				// transient cgroup scope. Retrying the idempotent create after that cleanup
				// is safer than surfacing a random start failure to the user.
				await pRetry(() => execa('virsh', ['--connect', LIBVIRT_URI, 'create', xmlPath], {timeout: 30_000}), {
					retries: 3,
					minTimeout: 250,
					maxTimeout: 1_000,
				})
			}

			await createWithGraphicsFallback(graphicsRenderNode, create, (error) => {
				const message = error instanceof Error ? error.message : String(error)
				this.logger.log(
					`GPU acceleration failed for ${definition.id} using ${graphicsRenderNode}; retrying with software graphics: ${message}`,
				)
			})
			return {acceleration}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			await fsp.writeFile(nodePath.join(runtimeDirectory, 'start-error.log'), message)
			await this.#unmountTpm(definition.id)
			await this.#unmountExternalDisk(definition.id)
			await this.#unmountStorage(definition.id)
			await this.#releaseAudio(definition.id)
			throw new Error(`[machine-start-failed] ${message}`)
		}
	}

	async state(id: string): Promise<DomainState> {
		const result = await execa('virsh', ['--connect', LIBVIRT_URI, 'domstate', this.domainName(id)], {
			reject: false,
			timeout: 10_000,
		})
		if (result.exitCode !== 0) {
			const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
			if (isMissingDomainError(output)) return 'stopped'
			throw new Error(`[machine-state-unavailable]${output ? ` ${output}` : ''}`)
		}
		const state = result.stdout.trim().toLowerCase()
		if (state.includes('pmsuspended')) return 'suspended'
		if (state.includes('paused')) return 'paused'
		if (state.includes('running') || state.includes('idle') || state.includes('blocked')) return 'running'
		if (state.includes('shut off') || state.includes('shutdown') || state.includes('crashed')) return 'stopped'
		throw new Error(`[machine-state-unavailable] Unexpected state: ${state || '(empty)'}`)
	}

	async stop(id: string, {force = false, timeout = 30_000} = {}) {
		if ((await this.state(id)) === 'stopped') {
			await this.#unmountTpm(id)
			await this.#unmountExternalDisk(id)
			await this.#unmountStorage(id)
			await this.#releaseAudio(id)
			return
		}
		const action = force ? 'destroy' : 'shutdown'
		const args = ['--connect', LIBVIRT_URI, action, this.domainName(id)]
		await execa('virsh', args, {reject: false, timeout: 10_000})
		try {
			await pWaitFor(async () => (await this.state(id)) === 'stopped', {
				interval: 500,
				timeout: force ? 10_000 : timeout,
			})
		} catch {
			throw new Error(force ? '[machine-force-stop-failed]' : '[machine-shutdown-timeout]')
		}
		await this.#unmountTpm(id)
		await this.#unmountExternalDisk(id)
		await this.#unmountStorage(id)
		await this.#releaseAudio(id)
	}

	async restart(id: string) {
		if ((await this.state(id)) !== 'running') throw new Error('[machine-not-running]')
		await execa('virsh', ['--connect', LIBVIRT_URI, 'reboot', this.domainName(id)], {timeout: 10_000})
	}

	async ejectInstallMedia(definition: MachineDefinition) {
		if ((await this.state(definition.id)) === 'stopped') return
		const target =
			definition.arch === 'arm64'
				? 'sda'
				: definition.platformProfile === 'windows-7-x86' || definition.diskBus === 'sata'
					? 'sdb'
					: definition.platformProfile === 'legacy-x86' || definition.platformProfile === 'windows-98-x86'
						? 'hdb'
						: 'sda'
		const cdrom = await execa(
			'virsh',
			['--connect', LIBVIRT_URI, 'change-media', this.domainName(definition.id), target, '--eject', '--live'],
			{
				reject: false,
				timeout: 10_000,
			},
		)
		if (cdrom.exitCode !== 0) {
			throw new Error(`[machine-install-media-eject-failed]${cdrom.stderr ? ` ${cdrom.stderr}` : ''}`)
		}
		if (definition.seedMedia) {
			await execa(
				'virsh',
				['--connect', LIBVIRT_URI, 'change-media', this.domainName(definition.id), 'sdb', '--eject', '--live'],
				{timeout: 10_000},
			)
		}
		if (definition.bootMedia) {
			const floppy = await execa(
				'virsh',
				['--connect', LIBVIRT_URI, 'change-media', this.domainName(definition.id), 'fda', '--eject', '--live'],
				{reject: false, timeout: 10_000},
			)
			if (floppy.exitCode !== 0) {
				throw new Error(`[machine-install-media-eject-failed]${floppy.stderr ? ` ${floppy.stderr}` : ''}`)
			}
		}
	}

	async resizeDisk(definition: MachineDefinition, disk: string, sizeGb: number) {
		if ((await this.state(definition.id)) === 'running') {
			await execa('virsh', [
				'--connect',
				LIBVIRT_URI,
				'blockresize',
				this.domainName(definition.id),
				machineDiskTarget(definition),
				`${sizeGb}G`,
			])
		} else {
			await execa('qemu-img', ['resize', '-f', 'qcow2', disk, `${sizeGb}G`])
		}
	}

	async diskVirtualSizeBytes(diskPath: string) {
		const result = await execa('qemu-img', ['info', '-f', 'qcow2', '--force-share', '--output=json', diskPath], {
			reject: false,
		})
		if (result.exitCode !== 0) throw new Error('[machine-disk-size-unavailable]')
		try {
			const size = (JSON.parse(result.stdout) as {'virtual-size'?: unknown})['virtual-size']
			if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw new Error()
			return size
		} catch {
			throw new Error('[machine-disk-size-unavailable]')
		}
	}

	async diskUsage(diskPath: string) {
		return (await this.diskUsageBytes(diskPath)) / 1_000_000_000
	}

	async diskUsageBytes(diskPath: string) {
		const result = await execa('qemu-img', ['info', '-f', 'qcow2', '--force-share', '--output=json', diskPath], {
			reject: false,
		})
		if (result.exitCode !== 0) return 0
		const info = JSON.parse(result.stdout) as {'actual-size'?: number}
		return info['actual-size'] ?? 0
	}

	async resourceStats() {
		const result = await execa(
			'virsh',
			['--connect', LIBVIRT_URI, 'domstats', '--cpu-total', '--balloon', '--list-running'],
			{reject: false, timeout: 10_000},
		)
		if (result.exitCode !== 0) return []
		return parseDomainResourceStats(result.stdout)
	}

	async convertDisk(
		source: string,
		destination: string,
		sizeGb: number,
		inputFormat: QemuImageFormat,
		signal: AbortSignal,
		onProgress?: (percent: number) => void,
	) {
		// Never let qemu-img probe an untrusted image. An explicit input driver is
		// the security boundary against a raw-looking image being interpreted as a
		// more powerful format that can reference host files or external resources.
		const infoResult = await execa(
			'qemu-img',
			qemuImageInfoArguments(source, inputFormat),
			installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS),
		)
		const info = JSON.parse(infoResult.stdout) as {'virtual-size': number; 'backing-filename'?: string}
		if (info['backing-filename']) throw new Error('[machine-image-backing-chain-not-supported]')
		if (info['virtual-size'] > sizeGb * 1_000_000_000) throw new Error('[machine-disk-too-small]')
		const conversion = execa(
			'qemu-img',
			qemuImageConvertArguments(source, destination, inputFormat),
			installCommandOptions(signal, MACHINE_INSTALL_COMMAND_TIMEOUT_MS),
		)
		conversion.stderr?.on('data', (data: Buffer) => {
			const percent = parseQemuImgProgress(data.toString())
			if (percent !== undefined) onProgress?.(percent)
		})
		await conversion
		onProgress?.(100)
		await execa(
			'qemu-img',
			['resize', '-f', 'qcow2', destination, `${sizeGb}G`],
			installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS),
		)
	}

	async createDisk(destination: string, sizeGb: number, signal: AbortSignal) {
		await execa(
			'qemu-img',
			['create', '-f', 'qcow2', destination, `${sizeGb}G`],
			installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS),
		)
	}

	async createWindows98Disk(destination: string, sizeGb: number, signal: AbortSignal) {
		const diskSizeBytes = sizeGb * 1_000_000_000
		const raw = `${destination}.${process.pid}.raw`
		try {
			const handle = await fsp.open(raw, 'w', 0o600)
			try {
				await handle.truncate(diskSizeBytes)
				await handle.write(buildWindows98Mbr(diskSizeBytes), 0, 512, 0)
			} finally {
				await handle.close()
			}
			await execa(
				'mformat',
				[
					'-i',
					`${raw}@@${WINDOWS_98_PARTITION_OFFSET_SECTORS * 512}`,
					'-F',
					'-H',
					String(WINDOWS_98_PARTITION_OFFSET_SECTORS),
					'-v',
					'UMBREL',
					'::',
				],
				installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS),
			)
			await execa(
				'qemu-img',
				['convert', '-f', 'raw', '-O', 'qcow2', raw, destination],
				installCommandOptions(signal, MACHINE_INSTALL_COMMAND_TIMEOUT_MS),
			)
		} catch (error) {
			await fse.remove(destination)
			throw error
		} finally {
			await fse.remove(raw)
		}
	}

	async pause(id: string) {
		await execa('virsh', ['--connect', LIBVIRT_URI, 'suspend', this.domainName(id)], {
			timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS,
		})
	}

	async resume(id: string) {
		await execa('virsh', ['--connect', LIBVIRT_URI, 'resume', this.domainName(id)], {
			reject: false,
			timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS,
		})
	}

	async pivotToBackupOverlay(definition: MachineDefinition, overlay: string) {
		const target = machineDiskTarget(definition)
		const runtimeOverlay = nodePath.join(this.storageDirectory(definition.id), 'operations', nodePath.basename(overlay))
		await execa(
			'virsh',
			[
				'--connect',
				LIBVIRT_URI,
				'snapshot-create-as',
				this.domainName(definition.id),
				`umbrel-backup-${Date.now()}`,
				'--no-metadata',
				'--disk-only',
				'--atomic',
				'--diskspec',
				`${target},snapshot=external,file=${runtimeOverlay},driver=qcow2`,
			],
			{timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS},
		)
	}

	async commitBackupOverlay(definition: MachineDefinition, overlay: string) {
		const state = await this.state(definition.id)
		if (state === 'running' || state === 'paused' || state === 'suspended') {
			const target = machineDiskTarget(definition)
			await execa('virsh', [
				'--connect',
				LIBVIRT_URI,
				'blockcommit',
				this.domainName(definition.id),
				target,
				'--active',
				'--pivot',
				'--delete',
				'--wait',
			])
		} else {
			// The live domain sees its disk through the ephemeral /run bind mount,
			// so QEMU records that alias as the overlay's backing filename. After a
			// host reboot the alias no longer exists. Retarget only the metadata to
			// the byte-identical canonical disk before committing the interrupted
			// backup overlay offline.
			const machineDirectory = nodePath.dirname(nodePath.dirname(overlay))
			await execa('qemu-img', [
				'rebase',
				'-f',
				'qcow2',
				'-u',
				'-b',
				nodePath.join(machineDirectory, 'disk.qcow2'),
				'-F',
				'qcow2',
				overlay,
			])
			await execa('qemu-img', ['commit', '-f', 'qcow2', overlay])
			await fse.remove(overlay)
		}
	}
}
