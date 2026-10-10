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
		if (!/^\/dev\/md\d+$/.test(device)) throw new Error(`Invalid md device: ${device}`)
		const {stdout} = await $`mdadm --detail ${device}`
		return stdout
	}

	async create({
		level,
		devices,
		name = 'umbrel-md',
		chunk,
		assumeClean = false,
	}: {
		level: MdadmLevel
		devices: string[]
		name?: string
		chunk?: number
		assumeClean?: boolean
	}): Promise<string> {
		if (!(await this.isSupported())) throw new Error('mdadm is not installed on this system')
		const minDevices = MDADM_MIN_DEVICES[level]
		if (devices.length < minDevices)
			throw new Error(`RAID level ${level} requires at least ${minDevices} devices (${devices.length} given)`)
		if (level === '10' && devices.length % 2 !== 0)
			throw new Error('RAID level 10 requires an even number of devices')
		for (const device of devices) {
			if (!/^\/dev\/(sd[a-z]+\d*|nvme\d+n\d+(p\d+)?|hd[a-z]+\d*|vd[a-z]+\d*)$/.test(device))
				throw new Error(`Refusing to use suspicious device path: ${device}`)
			if (!(await fse.pathExists(device))) throw new Error(`Device not found: ${device}`)
		}
		// Guard against clobbering ZFS-managed or mounted devices
		for (const device of devices) {
			try {
				const {stdout} = await $`lsblk --noheadings --output MOUNTPOINT ${device}`
				if (stdout.trim()) throw new Error(`Device ${device} is mounted (${stdout.trim()})`)
			} catch (error) {
				if (error instanceof Error && error.message.includes('is mounted')) throw error
			}
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
			'/dev/md0',
			...devices,
		]
		this.logger.log(`Creating mdadm RAID${level} (${name}) with: ${devices.join(' ')}`)
		// --run forces creation without interactive confirmation, --metadata=1.2 keeps
		// 4K alignment friendly superblocks readable by modern installers.
		const {stdout} = await $({input: 'y'})`mdadm ${args}`
		await this.saveConfig()
		return stdout
	}

	async add(arrayDevice: string, newDevice: string): Promise<void> {
		if (!/^\/dev\/md\d+$/.test(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		if (!(await fse.pathExists(newDevice))) throw new Error(`Device not found: ${newDevice}`)
		await $`mdadm --add ${arrayDevice} ${newDevice}`
		await this.saveConfig()
	}

	async remove(arrayDevice: string, memberDevice: string): Promise<void> {
		if (!/^\/dev\/md\d+$/.test(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		await $`mdadm --remove ${arrayDevice} ${memberDevice}`
		await this.saveConfig()
	}

	async fail(arrayDevice: string, memberDevice: string): Promise<void> {
		if (!/^\/dev\/md\d+$/.test(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		await $`mdadm --fail ${arrayDevice} ${memberDevice}`
	}

	async stop(arrayDevice: string): Promise<void> {
		if (!/^\/dev\/md\d+$/.test(arrayDevice)) throw new Error(`Invalid md device: ${arrayDevice}`)
		await $`mdadm --stop ${arrayDevice}`
	}

	async assembleScan(): Promise<string> {
		const {stdout} = await $`mdadm --assemble --scan`
		return stdout
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
