import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.js'

export type MdadmLevel = '0' | '1' | '5' | '6' | '10'
export type MdadmArrayState = 'clean' | 'active' | 'degraded' | 'recovering' | 'resync' | 'inactive' | 'unknown'
export type MdadmMemberState = 'active' | 'spare' | 'faulty' | 'removed' | 'sync' | 'unknown'

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
			if (/degraded/.test(rest)) state = 'degraded'
			else state = 'active'
			if (/\(clean\)/.test(lines[i + 1] ?? '') || /\(clean\)/.test(rest)) state = 'clean'
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
	if (stateRaw.includes('clean')) state = 'clean'
	else if (stateRaw.includes('degraded')) state = 'degraded'
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
	#umbreld: Umbreld
	logger: Umbreld['logger']

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
	}

	async stop() {
		this.logger.log('Stopping mdadm monitor')
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
			let detail = ''
			try {
				const {stdout} = await $`mdadm --detail ${entry.device}`
				detail = stdout
			} catch (error) {
				this.logger.error(`Failed to get mdadm detail for ${entry.device}`, error)
				arrays.push({
					device: entry.device,
					name: entry.device,
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
				})
				continue
			}
			const parsed = parseMdadmDetail(detail)
			const members = parseMdadmDetailMembers(detail)
			arrays.push({
				device: entry.device,
				name: parsed.name ?? entry.device,
				uuid: parsed.uuid,
				level: parsed.level ?? entry.level ?? 'unknown',
				raidDevices: parsed.raidDevices ?? 0,
				totalDevices: parsed.totalDevices ?? 0,
				activeDevices: parsed.activeDevices ?? 0,
				workingDevices: parsed.workingDevices ?? 0,
				failedDevices: parsed.failedDevices ?? 0,
				spareDevices: parsed.spareDevices ?? 0,
				state: entry.syncProgress !== undefined ? entry.state : (parsed.state ?? entry.state),
				syncProgress: entry.syncProgress,
				syncAction: entry.syncAction,
				members,
				rawDetail: detail,
			})
		}

		return {supported: true, exists: arrays.length > 0, arrays}
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
		if (level === '10' && devices.length % 2 !== 0)
			throw new Error('RAID level 10 requires an even number of devices')
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
		await this.saveConfig()
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

	async stop(arrayDevice: string): Promise<void> {
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

	async saveConfig(): Promise<void> {
		try {
			const {stdout} = await $`mdadm --detail --scan`
			await fse.ensureFile('/etc/mdadm/mdadm.conf')
			await fse.writeFile('/etc/mdadm/mdadm.conf', `${stdout}\n`)
			try {
				await $`update-initramfs -u -k all`
			} catch {
				// Best effort: initramfs refresh may fail in containers/CI
			}
		} catch (error) {
			this.logger.error('Failed to save mdadm config', error)
		}
	}
}
