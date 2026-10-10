import fse from 'fs-extra'
import {$} from 'execa'
import pRetry from 'p-retry'

import type Umbreld from '../../index.js'
import runEvery from '../utilities/run-every.js'

const STATUS_REFRESH_INTERVAL = '10 seconds'

export type MdadmLevel = '0' | '1' | '5' | '6' | '10'
export type MdadmArrayState = 'clean' | 'active' | 'degraded' | 'recovering' | 'resync' | 'inactive' | 'unknown'
export type MdadmMemberState = 'active' | 'spare' | 'faulty' | 'removed' | 'sync' | 'unknown'

// Filesystems the umbrelOS image can create on an mdadm array.
// - `native` filesystems store real Linux ownership/permissions (ext4, btrfs, xfs).
// - `synthetic` filesystems cannot (exfat, vfat, ntfs): mounts synthesize uid/gid.
export type MdadmFilesystem = 'ext4' | 'btrfs' | 'xfs' | 'exfat' | 'vfat' | 'ntfs'

// `labelMax` mirrors each mkfs tool's own limit: passing a longer label makes
// mkfs.vfat/mkfs.exfat silently drop the label (exit 0), so it must be enforced
// before the call rather than trusted to fail loudly.
export const MDADM_FILESYSTEMS: Record<
	MdadmFilesystem,
	{label: string; tool: string; native: boolean; labelMax: number}
> = {
	ext4: {label: 'ext4', tool: 'mkfs.ext4', native: true, labelMax: 16},
	btrfs: {label: 'btrfs', tool: 'mkfs.btrfs', native: true, labelMax: 255},
	xfs: {label: 'xfs', tool: 'mkfs.xfs', native: true, labelMax: 12},
	exfat: {label: 'exFAT', tool: 'mkfs.exfat', native: false, labelMax: 11},
	vfat: {label: 'FAT32', tool: 'mkfs.vfat', native: false, labelMax: 11},
	ntfs: {label: 'NTFS', tool: 'mkfs.ntfs', native: false, labelMax: 32},
}

export function isMdadmFilesystem(value: string): value is MdadmFilesystem {
	return Object.prototype.hasOwnProperty.call(MDADM_FILESYSTEMS, value)
}

export type MdadmFilesystemInfo = {
	value: MdadmFilesystem
	label: string
	tool: string
	native: boolean
	labelMax: number
}

// Directory name for an array's mount under MOUNT_ROOT. Prefers the mdadm array
// name, which lives in the superblock and therefore survives the array being
// reassembled onto a different /dev/mdN, and falls back to the device node name.
// Sanitized because mdadm names may carry a `hostname:name` homehost prefix.
export function mdadmMountName(device: string, name?: string): string {
	const fallback = device.replace('/dev/', '')
	// metadata 1.2 may report a `homehost:name` pair; the array name is the part
	// after the colon and never contains one itself.
	const raw = (name ?? '').trim().split(':').pop() ?? ''
	const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^[_.-]+/, '')
	return safe || fallback
}

export type MdadmMember = {
	device: string
	state: MdadmMemberState
	slot: number
}

export type MdadmArray = {
	device: string
	name: string
	uuid?: string
	level: string
	raidDevices: number
	totalDevices: number
	activeDevices: number
	workingDevices: number
	failedDevices: number
	spareDevices: number
	state: MdadmArrayState
	syncProgress?: number
	syncAction?: string
	size?: number
	members: MdadmMember[]
	rawDetail?: string
	/** Filesystem detected on the array, or null when unformatted. */
	filesystem?: MdadmFilesystemInfo | null
	/** Mountpoint when mounted, else null. */
	mountpoint?: string | null
}

export type MdadmStatus = {
	supported: boolean
	exists: boolean
	arrays: MdadmArray[]
}

export const MDADM_MIN_DEVICES: Record<MdadmLevel, number> = {
	'0': 2,
	'1': 2,
	'5': 3,
	'6': 4,
	'10': 4,
}

export const MDADM_MAX_DEVICE_INDEX = 31

const FSTAB_PATH = '/etc/fstab'

export function isValidMdDevice(device: string): boolean {
	return /^\/dev\/md\d+$/.test(device)
}

export function mdDeviceIndex(device: string): number {
	const m = device.match(/^\/dev\/md(\d+)$/)
	return m ? parseInt(m[1], 10) : -1
}

/** Find the first free /dev/mdN given a list of taken device paths. */
export function allocateNextMdDevice(taken: string[]): string {
	const takenIndexes = new Set(taken.map(mdDeviceIndex).filter((i) => i >= 0))
	for (let i = 0; i <= MDADM_MAX_DEVICE_INDEX; i++) {
		if (!takenIndexes.has(i)) return `/dev/md${i}`
	}
	throw new Error(`No free /dev/mdX slot (0-${MDADM_MAX_DEVICE_INDEX} all taken)`)
}

export function parseMdstat(mdstat: string): Array<{
	device: string
	state: MdadmArrayState
	syncProgress?: number
	syncAction?: string
	level?: string
}> {
	const arrays: Array<{
		device: string
		state: MdadmArrayState
		syncProgress?: number
		syncAction?: string
		level?: string
	}> = []
	const lines = mdstat.split('\n')
	for (let i = 0; i < lines.length; i++) {
		const header = lines[i].match(/^(md\d+)\s*:\s*(\w+)\s+(.*)$/)
		if (!header) continue
		const [, md, statusWord, rest] = header
		let state: MdadmArrayState = 'unknown'
		if (statusWord === 'active') {
			// mdstat never prints the word "degraded". A short array shows up as
			// `[N/M]` (M active of N configured) on the following detail line, or a
			// failed member marked `(F)` on the header line.
			const detailLine = lines[i + 1] ?? ''
			const counts = (detailLine.match(/\[(\d+)\/(\d+)\]/) ?? rest.match(/\[(\d+)\/(\d+)\]/)) as RegExpMatchArray | null
			const configured = counts ? parseInt(counts[1], 10) : undefined
			const active = counts ? parseInt(counts[2], 10) : undefined
			const hasFailedMember = /\(\w*F\w*\)/.test(rest) || /\(\w*F\w*\)/.test(detailLine)
			state = 'active'
			if ((configured !== undefined && active !== undefined && active < configured) || hasFailedMember) {
				state = 'degraded'
			}
			if (/\(clean\)/.test(detailLine) || /\(clean\)/.test(rest)) state = 'clean'
		} else if (statusWord === 'inactive') {
			state = 'inactive'
		}
		const levelMatch = rest.match(/raid(\d+)/)
		// Look ahead a few lines for resync/recovery progress: "[==>...]  resync = 12.3%"
		let syncProgress: number | undefined
		let syncAction: string | undefined
		for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
			const m = lines[j].match(/(resync|recovery|reshape|check)\s*=\s*([\d.]+)%/)
			if (m) {
				syncAction = m[1]
				syncProgress = parseFloat(m[2])
				state = m[1] === 'recovery' ? 'recovering' : 'resync'
				break
			}
		}
		arrays.push({device: `/dev/${md}`, state, syncProgress, syncAction, level: levelMatch?.[1]})
	}
	return arrays
}

export function parseMdadmDetail(detail: string): Partial<MdadmArray> {
	const get = (re: RegExp): string | undefined => detail.match(re)?.[1]?.trim()
	const raidLevel = get(/Raid Level\s*:\s*raid(\S+)/i) ?? get(/Raid Level\s*:\s*(\S+)/i)
	const arraySize = get(/Array Size\s*:\s*([\d.]+)/)
	const raidDevices = parseInt(get(/Raid Devices\s*:\s*(\d+)/) ?? '0', 10)
	const totalDevices = parseInt(get(/Total Devices\s*:\s*(\d+)/) ?? '0', 10)
	const activeDevices = parseInt(get(/Active Devices\s*:\s*(\d+)/) ?? '0', 10)
	const workingDevices = parseInt(get(/Working Devices\s*:\s*(\d+)/) ?? '0', 10)
	const failedDevices = parseInt(get(/Failed Devices\s*:\s*(\d+)/) ?? '0', 10)
	const spareDevices = parseInt(get(/Spare Devices\s*:\s*(\d+)/) ?? '0', 10)
	const stateRaw = (get(/State\s*:\s*([^\n]+)/) ?? '').toLowerCase()
	let state: MdadmArrayState = 'unknown'
	// A degraded array reports "clean, degraded", so test degraded before clean.
	if (stateRaw.includes('degraded')) state = 'degraded'
	else if (stateRaw.includes('clean')) state = 'clean'
	else if (stateRaw.includes('active')) state = 'active'
	const uuid = get(/UUID\s*:\s*([^\n]+)/)
	const name = get(/Name\s*:\s*([^\n]+)/)
	return {
		level: raidLevel,
		raidDevices: Number.isNaN(raidDevices) ? 0 : raidDevices,
		totalDevices: Number.isNaN(totalDevices) ? 0 : totalDevices,
		activeDevices: Number.isNaN(activeDevices) ? 0 : activeDevices,
		workingDevices: Number.isNaN(workingDevices) ? 0 : workingDevices,
		failedDevices: Number.isNaN(failedDevices) ? 0 : failedDevices,
		spareDevices: Number.isNaN(spareDevices) ? 0 : spareDevices,
		state,
		uuid,
		name,
		size: arraySize ? parseFloat(arraySize) : undefined,
	}
}

function parseMdadmDetailMembers(detail: string): MdadmMember[] {
	const members: MdadmMember[] = []
	const lines = detail.split('\n')
	let inTable = false
	for (const line of lines) {
		if (/Number\s+Major\s+Minor\s+RaidDevice\s+State/.test(line)) {
			inTable = true
			continue
		}
		if (!inTable) continue
		if (!line.trim()) break
		// e.g. "   0       8        1        0      active sync   /dev/sda1"
		const m = line.match(/^\s*(\d+)\s+\d+\s+\d+\s+(-?\d+)\s+(.+?)\s{2,}(\/\S+)?\s*$/)
		if (!m) continue
		const slot = parseInt(m[2], 10)
		const stateRaw = m[3].toLowerCase()
		const device = (m[4] ?? '').trim()
		let state: MdadmMemberState = 'unknown'
		if (stateRaw.includes('faulty')) state = 'faulty'
		else if (stateRaw.includes('removed')) state = 'removed'
		else if (stateRaw.includes('spare')) state = 'spare'
		else if (stateRaw.includes('sync') && !stateRaw.includes('active')) state = 'sync'
		else if (stateRaw.includes('active')) state = 'active'
		if (!device) continue
		members.push({device, state, slot})
	}
	return members
}

export default class Mdadm {
	/** Parent directory for array mounts (/dev/md0 -> /run/mdadm/md0). */
	static readonly MOUNT_ROOT = '/run/mdadm'

	#umbreld: Umbreld
	logger: Umbreld['logger']
	#cachedStatus: MdadmStatus | null = null
	#stopStatusRefresh: (() => void) | null = null

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`hardware:${name.toLowerCase()}`)
	}

	async start() {
		this.logger.log('Starting mdadm monitor')
		// Best-effort auto-assemble on every (re)start so arrays defined by
		// superblocks / mdadm.conf come back after reboot, reflash or power loss.
		// The dedicated systemd unit (umbrel-mdadm-assemble) already runs before
		// umbreld, this is a second chance inside containers / dev envs.
		try {
			const output = await this.assembleScan({run: true})
			if (output.trim()) this.logger.log(`mdadm auto-assemble: ${output.trim()}`)
		} catch (error) {
			this.logger.error('mdadm auto-assemble at start failed (non-fatal)', error)
		}
		// Keep the cached inventory warm so Files can list /Raid mounts without
		// shelling out per request.
		void this.getStatus().catch(() => {})
		this.#stopStatusRefresh = runEvery(STATUS_REFRESH_INTERVAL, async () => {
			await this.getStatus().catch(() => {})
		})
	}

	// Lifecycle hook called by hardware.stop(). Distinct from stopArray(), which
	// stops an individual /dev/mdN — hence the name: an overloaded `stop` would
	// both collide at the type level and silently shadow the other at run time.
	async stop() {
		this.logger.log('Stopping mdadm monitor')
		this.#stopStatusRefresh?.()
		this.#stopStatusRefresh = null
	}

	/** Latest inventory snapshot, or null before the first refresh. */
	getCachedStatus(): MdadmStatus | null {
		return this.#cachedStatus
	}

	async isSupported(): Promise<boolean> {
		try {
			await $`mdadm --version`
			return true
		} catch {
			return false
		}
	}

	async getStatus(): Promise<MdadmStatus> {
		const supported = await this.isSupported()
		if (!supported) return {supported: false, exists: false, arrays: []}

		let mdstat = ''
		try {
			mdstat = await fse.readFile('/proc/mdstat', 'utf8')
		} catch {
			return {supported: true, exists: false, arrays: []}
		}

		const mdstatArrays = parseMdstat(mdstat)
		if (mdstatArrays.length === 0) return {supported: true, exists: false, arrays: []}

		const arrays: MdadmArray[] = []
		for (const entry of mdstatArrays) {
			const [filesystem, mountpoint] = await Promise.all([
				this.#getFilesystemType(entry.device),
				this.getMountpoint(entry.device),
			])
			const base = {
				filesystem: filesystem ? {value: filesystem, ...MDADM_FILESYSTEMS[filesystem]} : null,
				mountpoint,
			}
			let detail = ''
			try {
				const {stdout} = await $`mdadm --detail ${entry.device}`
				detail = stdout
			} catch (error) {
				this.logger.error(`Failed to get mdadm detail for ${entry.device}`, error)
				arrays.push({
					device: entry.device,
					// Empty name lets mountpointFor()/Files fall back to the device node.
					name: '',
					level: entry.level ?? 'unknown',
					raidDevices: 0,
					totalDevices: 0,
					activeDevices: 0,
					workingDevices: 0,
					failedDevices: 0,
					spareDevices: 0,
					state: entry.state,
					syncProgress: entry.syncProgress,
					syncAction: entry.syncAction,
					members: [],
					rawDetail: detail,
					...base,
				})
				continue
			}
			const parsed = parseMdadmDetail(detail)
			const members = parseMdadmDetailMembers(detail)
			arrays.push({
				device: entry.device,
				name: parsed.name ?? '',
				uuid: parsed.uuid,
				level: parsed.level ?? entry.level ?? 'unknown',
				raidDevices: parsed.raidDevices ?? 0,
				totalDevices: parsed.totalDevices ?? 0,
				activeDevices: parsed.activeDevices ?? 0,
				workingDevices: parsed.workingDevices ?? 0,
				failedDevices: parsed.failedDevices ?? 0,
				spareDevices: parsed.spareDevices ?? 0,
				// Prefer the more specific of the two sources: mdstat carries live
				// resync/degraded state, --detail carries clean/degraded. Fall back to
				// mdstat when the detail parser could not classify the State line.
				state:
					entry.syncProgress !== undefined
						? entry.state
						: parsed.state && parsed.state !== 'unknown'
							? parsed.state
							: entry.state,
				syncProgress: entry.syncProgress,
				syncAction: entry.syncAction,
				members,
				rawDetail: detail,
				...base,
			})
		}

		const status: MdadmStatus = {supported: true, exists: arrays.length > 0, arrays}
		this.#cachedStatus = status
		return status
	}

	async detail(device: string): Promise<string> {
		if (!isValidMdDevice(device)) throw new Error(`Invalid md device: ${device}`)
		const {stdout} = await $`mdadm --detail ${device}`
		return stdout
	}

	/** List taken /dev/mdN from /proc/mdstat + /dev nodes. */
	async listTakenDevices(): Promise<string[]> {
		const taken = new Set<string>()
		try {
			const mdstat = await fse.readFile('/proc/mdstat', 'utf8')
			for (const entry of parseMdstat(mdstat)) taken.add(entry.device)
		} catch {
			// No mdstat (no arrays or unsupported kernel) — fall through to /dev scan
		}
		for (let i = 0; i <= MDADM_MAX_DEVICE_INDEX; i++) {
			const candidate = `/dev/md${i}`
			try {
				if (await fse.pathExists(candidate)) taken.add(candidate)
			} catch {
				// ignore
			}
		}
		return [...taken]
	}

	async allocateDevice(): Promise<string> {
		return allocateNextMdDevice(await this.listTakenDevices())
	}

	async create({
		level,
		devices,
		name = 'umbrel-md',
		chunk,
		assumeClean = false,
		device,
	}: {
		level: MdadmLevel
		devices: string[]
		name?: string
		chunk?: number
		assumeClean?: boolean
		/** Target array node. Defaults to the first free /dev/mdN (multi-array support). */
		device?: string
	}): Promise<{device: string; output: string}> {
		if (!(await this.isSupported())) throw new Error('mdadm is not installed on this system')
		const minDevices = MDADM_MIN_DEVICES[level]
		if (devices.length < minDevices)
			throw new Error(`RAID level ${level} requires at least ${minDevices} devices (${devices.length} given)`)
		if (level === '10' && devices.length % 2 !== 0) throw new Error('RAID level 10 requires an even number of devices')
		for (const member of devices) {
			if (!/^\/dev\/(sd[a-z]+\d*|nvme\d+n\d+(p\d+)?|hd[a-z]+\d*|vd[a-z]+\d*)$/.test(member))
				throw new Error(`Refusing to use suspicious device path: ${member}`)
			if (!(await fse.pathExists(member))) throw new Error(`Device not found: ${member}`)
		}
		// Guard against clobbering ZFS-managed or mounted devices
		for (const member of devices) {
			try {
				const {stdout} = await $`lsblk --noheadings --output MOUNTPOINT ${member}`
				if (stdout.trim()) throw new Error(`Device ${member} is mounted (${stdout.trim()})`)
			} catch (error) {
				if (error instanceof Error && error.message.includes('is mounted')) throw error
			}
		}

		// Clear stale md superblocks so a drive reused from a previous array can be
		// claimed again; without this mdadm --create refuses members that still
		// carry a superblock ("appears to be part of an md array"). Best effort:
		// a member with no superblock reports an error we deliberately ignore.
		for (const member of devices) {
			await $({reject: false})`mdadm --zero-superblock ${member}`
		}

		// Resolve target node: explicit /dev/mdN or first free slot (multi-array).
		let target = device
		if (target) {
			if (!isValidMdDevice(target)) throw new Error(`Invalid md device: ${target}`)
			const taken = await this.listTakenDevices()
			if (taken.includes(target)) throw new Error(`Array device already in use: ${target}`)
		} else {
			target = await this.allocateDevice()
		}

		const args = [
			'--create',
			'--run',
			'--metadata=1.2',
			`--level=${level}`,
			`--raid-devices=${devices.length}`,
			`--name=${name}`,
			...(chunk ? [`--chunk=${chunk}`] : []),
			...(assumeClean ? ['--assume-clean'] : []),
			target,
			...devices,
		]
		this.logger.log(`Creating mdadm RAID${level} (${name}) on ${target} with: ${devices.join(' ')}`)
		// --run forces creation without interactive confirmation, --metadata=1.2 keeps
		// 4K alignment friendly superblocks readable by modern installers.
		const {stdout} = await $({input: 'y'})`mdadm ${args}`
		// A new array adds a UUID to mdadm.conf, so the initramfs must be refreshed
		// for it to assemble in early boot.
		await this.saveConfig({updateInitramfs: true})
		return {device: target, output: stdout}
	}

	async add(arrayDevice: string, newDevice: string): Promise<void> {
		if (!isValidMdDevice(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		if (!(await fse.pathExists(newDevice))) throw new Error(`Device not found: ${newDevice}`)
		await $`mdadm --add ${arrayDevice} ${newDevice}`
		await this.saveConfig()
	}

	async remove(arrayDevice: string, memberDevice: string): Promise<void> {
		if (!isValidMdDevice(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		await $`mdadm --remove ${arrayDevice} ${memberDevice}`
		await this.saveConfig()
	}

	async fail(arrayDevice: string, memberDevice: string): Promise<void> {
		if (!isValidMdDevice(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		await $`mdadm --fail ${arrayDevice} ${memberDevice}`
	}

	/** Stop a running array (`mdadm --stop`). Lifecycle stop() stops the monitor. */
	async stopArray(arrayDevice: string): Promise<void> {
		if (!isValidMdDevice(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		await $`mdadm --stop ${arrayDevice}`
	}

	async assembleScan({run = false} = {}): Promise<string> {
		const args = ['--assemble', '--scan', ...(run ? ['--run'] : [])]
		const {stdout} = await $`mdadm ${args}`
		return stdout
	}

	/**
	 * Grow / reshape an array.
	 * - RAID5/6 expansion: add spares first (via add()), then grow --raid-devices to the
	 *   new total. mdadm reshapes in place; progress shows up as `reshape` in /proc/mdstat.
	 * - Level migration: e.g. RAID1 -> RAID5, RAID5 -> RAID6 (requires mdadm >= 3.x, may
	 *   need --backup-file for safety).
	 * - `--size=max` reuses the full capacity after replacing members with larger disks.
	 */
	async grow(
		arrayDevice: string,
		{
			raidDevices,
			level,
			backupFile,
			sizeMax = false,
		}: {raidDevices?: number; level?: MdadmLevel; backupFile?: string; sizeMax?: boolean},
	): Promise<string> {
		if (!isValidMdDevice(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		if (raidDevices !== undefined && (!Number.isInteger(raidDevices) || raidDevices < 1))
			throw new Error(`Invalid raidDevices count: ${raidDevices}`)
		// Migrating down to RAID0 is never a supported target: it silently drops all
		// redundancy and needs at least two members. Refuse rather than reshape.
		if (level === '0') throw new Error('Migrating an array to RAID0 is not supported')
		if (raidDevices === undefined && !level && !sizeMax)
			throw new Error('grow requires at least one of: raidDevices, level, sizeMax')
		const args = [
			'--grow',
			arrayDevice,
			...(raidDevices !== undefined ? [`--raid-devices=${raidDevices}`] : []),
			...(level ? [`--level=${level}`] : []),
			...(backupFile ? [`--backup-file=${backupFile}`] : []),
			...(sizeMax ? ['--size=max'] : []),
		]
		this.logger.log(`Growing ${arrayDevice}: ${args.join(' ')}`)
		const {stdout} = await $`mdadm ${args}`
		await this.saveConfig()
		return stdout
	}

	/**
	 * Convenience: hot-add new devices as spares then expand RAID5/6 to include them.
	 * newTotal = current raidDevices + newDevices.length. Reshape progress is visible
	 * via getStatus() (syncAction=reshape, syncProgress 0-100).
	 */
	async growAddAndExpand(arrayDevice: string, newDevices: string[]): Promise<string> {
		if (!isValidMdDevice(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		if (newDevices.length === 0) throw new Error('At least one new device is required')
		for (const device of newDevices) {
			if (!(await fse.pathExists(device))) throw new Error(`Device not found: ${device}`)
			await $`mdadm --add ${arrayDevice} ${device}`
		}
		const status = await this.getStatus()
		const array = status.arrays.find((a) => a.device === arrayDevice)
		if (!array) throw new Error(`Array not found after adding spares: ${arrayDevice}`)
		const newTotal = array.raidDevices + newDevices.length
		return this.grow(arrayDevice, {raidDevices: newTotal})
	}

	/** After replacing members with larger disks, grow the array to use the full capacity. */
	async growToMaxSize(arrayDevice: string): Promise<string> {
		return this.grow(arrayDevice, {sizeMax: true})
	}

	/**
	 * Directory name an array is mounted under. Prefers the mdadm array name
	 * (stored in the superblock, so it survives reassembly onto another /dev/mdN)
	 * and falls back to the device node name. This is also the name Files exposes
	 * as /Raid/<name>, so the two must agree.
	 */
	async mountNameFor(device: string, name?: string): Promise<string> {
		return mdadmMountName(device, name ?? (await this.#resolveArrayName(device)))
	}

	/** Mountpoint of an array device (e.g. /dev/md0 -> /run/mdadm/umbrel-md). */
	async mountpointFor(device: string, name?: string): Promise<string> {
		if (!isValidMdDevice(device)) throw new Error(`Invalid md device: ${device}`)
		return `${Mdadm.MOUNT_ROOT}/${await this.mountNameFor(device, name)}`
	}

	// Array name from the cached inventory, falling back to a direct `--detail`
	// read so a just-created array (cache not refreshed yet) still resolves.
	async #resolveArrayName(device: string): Promise<string | undefined> {
		const cached = this.#cachedStatus?.arrays.find((array) => array.device === device)?.name
		if (cached) return cached
		const {stdout, exitCode} = await $({reject: false})`mdadm --detail ${device}`
		if (exitCode !== 0) return undefined
		return parseMdadmDetail(stdout).name
	}

	/**
	 * Current mount of an array device, or null when unmounted. Uses findmnt so
	 * only the array's own mount is reported (lsblk would also list child
	 * filesystems of a partitioned array).
	 */
	async getMountpoint(device: string): Promise<string | null> {
		const {stdout, exitCode} = await $({reject: false})`findmnt --noheadings --output TARGET --source ${device}`
		if (exitCode === 0 && stdout.trim()) return stdout.trim().split('\n')[0].trim()
		return null
	}

	// Args for each supported filesystem's mkfs tool.
	static readonly MKFS_ARGS: Record<MdadmFilesystem, (label: string) => string[]> = {
		ext4: (label) => ['mkfs.ext4', '-F', '-L', label],
		btrfs: (label) => ['mkfs.btrfs', '-f', '-L', label],
		xfs: (label) => ['mkfs.xfs', '-f', '-L', label],
		exfat: (label) => ['mkfs.exfat', '-n', label],
		vfat: (label) => ['mkfs.vfat', '-F', '32', '-n', label],
		ntfs: (label) => ['mkfs.ntfs', '-f', '-L', label],
	}

	// Filesystems whose mkfs prompts before overwriting an existing partition.
	private static readonly MKFS_NEEDS_CONFIRMATION: ReadonlySet<MdadmFilesystem> = new Set(['btrfs', 'xfs', 'ntfs'])

	/**
	 * Create a filesystem on an array device. Every filesystem present in the
	 * umbrelOS image is supported: ext4, btrfs, xfs, exFAT, FAT32, NTFS.
	 * exFAT/FAT32/NTFS are synthetic-ownership filesystems: they cannot store
	 * Linux ownership so mounts must pass uid/gid (see mount()).
	 */
	async format(
		device: string,
		filesystem: MdadmFilesystem,
		{label = 'umbrel-md'}: {label?: string} = {},
	): Promise<string> {
		if (!isValidMdDevice(device)) throw new Error(`Invalid md device: ${device}`)
		if (!isMdadmFilesystem(filesystem)) throw new Error(`Unsupported filesystem: ${filesystem}`)
		const {tool, labelMax} = MDADM_FILESYSTEMS[filesystem]
		// Fail fast when the mkfs binary is missing from the image. `command` is a
		// shell builtin and execa spawns without a shell, so use `which`.
		const {exitCode} = await $({reject: false})`which ${tool}`
		if (exitCode !== 0) throw new Error(`mkfs tool not available: ${tool}`)
		if (label.length > labelMax) throw new Error(`Label too long for ${filesystem} (max ${labelMax} characters)`)
		if (await this.getMountpoint(device)) throw new Error(`Device ${device} is mounted, unmount it before formatting`)

		const args = Mdadm.MKFS_ARGS[filesystem](label)
		const {stdout} = Mdadm.MKFS_NEEDS_CONFIRMATION.has(filesystem)
			? await $({input: 'y'})`${args} ${device}`
			: await $`${args} ${device}`
		return stdout
	}

	/**
	 * Mount an array. Returns the mountpoint (under MOUNT_ROOT, survives umbreld restarts).
	 * Synthetic-ownership filesystems get uid/gid from the umbrel user so files stay writable.
	 * Persists an /etc/fstab entry so the array is remounted on every boot.
	 */
	async mount(device: string, {uid = 1000, gid = 1000}: {uid?: number; gid?: number} = {}): Promise<string> {
		if (!isValidMdDevice(device)) throw new Error(`Invalid md device: ${device}`)
		const existing = await this.getMountpoint(device)
		if (existing) return existing

		const fstype = await this.#getFilesystemType(device)
		if (!fstype) throw new Error(`No supported filesystem found on ${device}`)
		const mountpoint = await this.mountpointFor(device)
		// x-mount.mkdir lets the boot-time `mount -a` recreate the mountpoint on
		// the tmpfs /run/mdadm (nothing persists there across a reboot).
		const options = [
			'nofail',
			'x-mount.mkdir=0755',
			...(MDADM_FILESYSTEMS[fstype].native ? [] : [`uid=${uid}`, `gid=${gid}`, `umask=007`]),
		]
		await fse.ensureDir(mountpoint)
		await $`mount -t ${fstype} -o ${options.join(',')} ${device} ${mountpoint}`
		await this.#persistMount(device, fstype, mountpoint, options)
		return mountpoint
	}

	async unmount(device: string): Promise<void> {
		const mountpoint = (await this.getMountpoint(device)) ?? (await this.mountpointFor(device))
		// Retry like external storage: Samba/indexers may hold handles briefly.
		await pRetry(() => $`umount ${mountpoint}`, {
			retries: 5,
			minTimeout: 500,
			factor: 1,
			onFailedAttempt: (error) => {
				this.logger.log(
					`Unmount attempt ${error.attemptNumber} for ${device} failed, ${error.retriesLeft} retries left`,
				)
			},
		}).catch((error) => {
			this.logger.error(`Failed to unmount ${device} from ${mountpoint}`, error)
			throw error
		})
		await this.#removePersistedMount(device, mountpoint)
	}

	/**
	 * Persist a mount to /etc/fstab, keyed by filesystem UUID so the entry keeps
	 * working when the array lands on a different /dev/mdN after reassembly.
	 * The umbrel-mdadm-mount.service unit replays this list with `mount -a` at boot.
	 */
	async #persistMount(device: string, fstype: MdadmFilesystem, mountpoint: string, options: string[]) {
		try {
			const mountSpec = (await this.#getFilesystemUuid(device)) ?? device
			// x-mount.mkdir lets the boot-time `mount -a` recreate the mountpoint on
			// the tmpfs /run/mdadm, which is empty after every reboot. mount() already
			// includes it in the live options, so dedupe before writing fstab.
			const fstabOptions = [...new Set([...options, 'x-mount.mkdir=0755'])].join(',')
			const entry = `UUID=${mountSpec} ${mountpoint} ${fstype} ${fstabOptions} 0 0\n`
			const existing = await fse.readFile(FSTAB_PATH, 'utf8').catch(() => '')
			const lines = existing.split('\n').filter((line) => {
				if (!line.trim() || line.trim().startsWith('#')) return true
				return !this.#isRaidFstabLine(line, mountpoint)
			})
			lines.push(entry.trim())
			const next = `${lines.join('\n').trim()}\n`
			if (next !== existing) {
				await fse.ensureFile(FSTAB_PATH)
				await fse.writeFile(FSTAB_PATH, next)
				this.logger.log(`Persisted mount '${device}' -> ${mountpoint} to fstab`)
			}
		} catch (error) {
			this.logger.error(`Failed to persist fstab entry for ${device}`, error)
		}
	}

	async #removePersistedMount(device: string, mountpoint?: string) {
		try {
			const target = mountpoint ?? (await this.mountpointFor(device))
			const existing = await fse.readFile(FSTAB_PATH, 'utf8').catch(() => '')
			const next = existing
				.split('\n')
				.filter((line) => !(line.trim() && this.#isRaidFstabLine(line, target)))
				.join('\n')
			if (next !== existing) {
				await fse.writeFile(FSTAB_PATH, next)
				this.logger.log(`Removed persisted mount '${device}' from fstab`)
			}
		} catch (error) {
			this.logger.error(`Failed to remove fstab entry for ${device}`, error)
		}
	}

	// True when an fstab line is an mdadm array mount under MOUNT_ROOT. Matching on
	// the mountpoint keeps entries findable and removable even after the array's
	// /dev/mdN node changes, since the mountpoint derives from the array name.
	#isRaidFstabLine(line: string, mountpoint?: string): boolean {
		if (line.trim().startsWith('#')) return false
		const [spec, target] = line.trim().split(/\s+/)
		if (!spec || !target) return false
		if (!target.startsWith(`${Mdadm.MOUNT_ROOT}/`)) return false
		if (mountpoint) return target === mountpoint
		return true
	}

	async #getFilesystemUuid(device: string): Promise<string | null> {
		const {stdout, exitCode} = await $({reject: false})`blkid -s UUID -o value ${device}`
		if (exitCode !== 0) return null
		const uuid = stdout.trim()
		return uuid || null
	}

	async #getFilesystemType(device: string): Promise<MdadmFilesystem | null> {
		const {stdout, exitCode} = await $({reject: false})`lsblk --noheadings --nodeps --output FSTYPE ${device}`
		if (exitCode !== 0) return null
		const fstype = stdout.trim()
		return isMdadmFilesystem(fstype) ? fstype : null
	}

	/** Public form of the filesystem lookup so routes can report a formatted/unformatted array. */
	async getFilesystemType(device: string): Promise<MdadmFilesystem | null> {
		if (!isValidMdDevice(device)) throw new Error(`Invalid md device: ${device}`)
		return this.#getFilesystemType(device)
	}

	/** Filesystem catalogue for the UI (label, mkfs tool, native ownership flag). */
	listFilesystems(): MdadmFilesystemInfo[] {
		return Object.entries(MDADM_FILESYSTEMS).map(([value, meta]) => ({
			value: value as MdadmFilesystem,
			label: meta.label,
			tool: meta.tool,
			native: meta.native,
			labelMax: meta.labelMax,
		}))
	}

	async saveConfig({updateInitramfs = false}: {updateInitramfs?: boolean} = {}): Promise<void> {
		try {
			const {stdout} = await $`mdadm --detail --scan`
			await fse.ensureFile('/etc/mdadm/mdadm.conf')
			await fse.writeFile('/etc/mdadm/mdadm.conf', `${stdout}\n`)
			// Refreshing the initramfs is expensive (rebuilds every kernel image), so
			// only do it when the set of arrays changes, not on every reshape.
			if (updateInitramfs) {
				try {
					await $`update-initramfs -u -k all`
				} catch {
					// Best effort: initramfs refresh may fail in containers/CI
				}
			}
		} catch (error) {
			this.logger.error('Failed to save mdadm config', error)
		}
	}
}
