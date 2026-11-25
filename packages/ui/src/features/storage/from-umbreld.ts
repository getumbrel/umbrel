// From what umbreld reports to what the storage screens show.
//
// hardware.raid.getStatus describes the storage, hardware.internalStorage.getDevices the
// drives in the machine, and the progress events the task that is running. This turns the
// three into a StorageState, and a list of drives into the Hardware the setup step takes.
// Everything here is pure, so each way umbreld can describe a storage can be tested.
//
// umbreld says that a task is running and how far along it is, never which drives it involves.
// The browser that started a task remembers that much (TaskRecord), and when it isn't there
// the screens show the task without it.

import type {RaidProgress} from './hooks/use-raid-progress'
import type {RaidStatus, StorageDevice} from './hooks/use-storage'
import {Drive, DriveKind, FailsafeLayout, Hardware, Layout, placeMissing} from './model'
import type {StartFailureDrive} from './start-failure'
import type {Member, MemberState, Operation, StorageAction, StorageState} from './state'
import {getPoolDeviceType} from './utils'

// What this browser asked umbreld to do, for as long as it is being done
export type TaskRecord =
	// `keepsOld` when the drive being replaced was working: it stays connected, and needed,
	// until its replacement holds everything
	| {kind: 'replace'; oldId: string; newId: string; keepsOld?: boolean; at: number}
	| {kind: 'add'; id: string; at: number}
	| {kind: 'failsafe'; to: FailsafeLayout; newIds: string[]; accelId?: string; at: number}

export function recordOf(action: StorageAction, at: number, oldWasWorking = false): TaskRecord | null {
	if (action.type === 'replace') {
		return {kind: 'replace', oldId: action.memberId, newId: action.newId, keepsOld: oldWasWorking, at}
	}
	if (action.type === 'repair') return {kind: 'replace', oldId: action.memberId, newId: action.memberId, at}
	if (action.type === 'add') return {kind: 'add', id: action.id, at}
	if (action.type === 'failsafe') {
		const newIds = action.to === 'mirror' ? action.pairs.map((pair) => pair.newId) : action.newIds
		return {kind: 'failsafe', to: action.to, newIds, accelId: action.accelId, at}
	}
	return null
}

type RaidMember = NonNullable<RaidStatus['devices']>[number]

// ---------------------------------------------------------------------------
// Drives
// ---------------------------------------------------------------------------

export function toDrive(device: StorageDevice & {id: string}, member?: RaidMember): Drive {
	const errors = member ? member.readErrors + member.writeErrors + member.checksumErrors : 0
	const ssd = device.type === 'ssd' ? device : undefined
	return {
		id: device.id,
		kind: device.type,
		size: device.roundedSize ?? device.size,
		model: device.name,
		serial: device.serial,
		slot: device.slot && device.slot >= 1 && device.slot <= 4 ? device.slot : undefined,
		smart: device.smartStatus,
		temperature: device.temperature,
		// Only NVMe SSDs report their limits and their wear
		temperatureWarning: ssd?.temperatureWarning,
		temperatureCritical: ssd?.temperatureCritical,
		lifetimeUsed: ssd?.lifetimeUsed,
		system: device.isSystemDrive || undefined,
		errors: errors > 0 ? errors : undefined,
		// The storage still uses the drive, but no longer trusts it
		degraded: member?.status === 'DEGRADED' || undefined,
	}
}

// umbreld rounds a drive's size down to a step before it partitions it (to 250GB from 1TB up,
// to 25GB from 250GB up) and keeps about 110MB aside, so the storage remembers a little less
// than the step. Rounding back up gives the size the drive counts as. The margin is far more
// than umbreld keeps aside and far less than a step, so a 960GB drive stays 950GB and a 240GB
// drive, which is never rounded, stays as it is.
const SET_ASIDE_MARGIN = 1_000_000_000
function countedSize(remembered: number): number {
	const step =
		remembered >= 1_000_000_000_000 - SET_ASIDE_MARGIN
			? 250_000_000_000
			: remembered >= 250_000_000_000 - SET_ASIDE_MARGIN
				? 25_000_000_000
				: 0
	return step ? Math.ceil(remembered / step) * step : remembered
}

// A drive the machine can't see leaves its name in the storage behind, and the size the storage
// remembers for it. The name is the one udev gives the drive: its model and serial number joined
// by underscores (WDC_WD80EFAX-68KNBN0_VAJ1ABCD), with the namespace on the end for NVMe
// (Samsung_SSD_990_PRO_2TB_S7KGNJ0X123456_1). A name without that shape is shown whole.
export function missingDrive(id: string, kind: DriveKind, size: number | undefined): Drive {
	const name = id.replace(/_\d{1,2}$/, '')
	const cut = name.lastIndexOf('_')
	return {
		id,
		kind,
		size: size ? countedSize(size) : 0,
		model: cut > 0 ? name.slice(0, cut).replaceAll('_', ' ').trim() : '',
		serial: cut > 0 ? name.slice(cut + 1) : id,
		smart: 'unknown',
		absent: true,
	}
}

const withId = (device: StorageDevice): device is StorageDevice & {id: string} => !!device.id

// The machine as the setup step sees it. A drive without a stable name can't be given to
// umbreld, so it isn't offered.
export function toHardware(devices: StorageDevice[], isPro: boolean): Hardware {
	return {
		device: isPro ? 'pro' : 'other',
		drives: devices
			.filter(withId)
			// Umbrel Pro's storage is its four SSD slots
			.filter((device) => !isPro || (device.type === 'ssd' && !device.isSystemDrive))
			.map((device) => toDrive(device)),
	}
}

// ---------------------------------------------------------------------------
// The storage
// ---------------------------------------------------------------------------

const isUp = (status: string | undefined) => status === 'ONLINE' || status === 'DEGRADED'

function memberState(member: RaidMember, device: StorageDevice | undefined): MemberState {
	if (isUp(member.status)) return 'online'
	if (!device) return 'missing'
	// A drive the storage has let go of can be rebuilt where it is, unless it is failing itself
	return device.smartStatus === 'unhealthy' ? 'failed' : 'unusable'
}

export function layoutOf(raid: RaidStatus): Layout {
	if (raid.topology === 'raidz') return raid.raidzParity === 2 ? 'raidz2' : 'raidz1'
	// A mirror that umbreld calls 'storage' is a switch that stopped part way: some drives are
	// paired and the rest are plain storage
	if (raid.topology === 'mirror' && raid.raidType === 'failsafe') return 'mirror'
	return 'stripe'
}

// The task that is running, in the screens' terms
function toOperation(
	progress: RaidProgress | null,
	layout: Layout,
	record: TaskRecord | null,
	isMember: (id: string) => boolean,
	isAttached: (id: string) => boolean,
): Operation | null {
	if (!progress) return null
	const {type, state} = progress
	if (state === 'finished' || state === 'complete' || state === 'canceled' || state === 'error') return null
	if (type === 'scrub') return {kind: 'check', progress: progress.progress}
	if (type === 'expansion') {
		const added = record?.kind === 'add' && isMember(record.id) ? record.id : undefined
		return {kind: 'expand', progress: progress.progress, memberId: added}
	}
	if (type === 'replace' || type === 'rebuild') {
		const replace = record?.kind === 'replace' ? record : null
		return {
			kind: 'rebuild',
			progress: progress.progress,
			memberId: replace && isMember(replace.newId) ? replace.newId : undefined,
			// A working drive stays connected until its replacement holds everything. One the storage
			// had already let go of is simply no longer part of it.
			oldId:
				replace?.keepsOld && replace.oldId !== replace.newId && isAttached(replace.oldId) ? replace.oldId : undefined,
		}
	}
	const failsafe = record?.kind === 'failsafe' ? record : null
	// The storage only shows the level it is switching to once it has it: mirrored pairs from the
	// first moment, one- and two-drive protection after the restart. Before that, the browser that
	// started the switch knows.
	const to: FailsafeLayout | undefined = layout !== 'stripe' ? layout : failsafe?.to
	return {
		kind: 'failsafe',
		phase: state === 'rebooting' ? 'restarting' : state === 'rebuilding' ? 'rebuilding' : 'copying',
		progress: progress.progress,
		to,
		newIds: failsafe?.newIds,
		accelId: failsafe?.accelId,
	}
}

export function toStorageState({
	raid,
	devices,
	isPro,
	progress,
	record,
	failsafeError,
	finished,
}: {
	raid: RaidStatus
	devices: StorageDevice[]
	isPro: boolean
	// The task that is running, from umbreld's events and its status
	progress: RaidProgress | null
	record: TaskRecord | null
	// What umbreld said when turning on FailSafe didn't finish
	failsafeError?: string | null
	finished?: StorageState['finished']
}): StorageState | null {
	// An Umbrel Pro's storage is SSDs, even when none of them can be seen
	const kind = getPoolDeviceType(raid, devices) ?? (isPro ? 'ssd' : undefined)
	if (!raid.exists || !kind) return null
	const layout = layoutOf(raid)
	const attached = devices.filter(withId)
	const deviceOf = (id: string) => attached.find((device) => device.id === id)
	const raidMembers = raid.devices ?? []
	const accelMembers = raid.accelerator?.devices ?? []
	const replace = record?.kind === 'replace' ? record : null
	const running = !!progress && !['finished', 'complete', 'canceled', 'error'].includes(progress.state)
	const rebuilding = running && (progress.type === 'replace' || progress.type === 'rebuild')

	// While a drive is replaced the storage lists both the old and the new one. The old one is
	// on its way out, so it is no longer shown as a member.
	const leavingId =
		rebuilding && replace && replace.oldId !== replace.newId && raidMembers.some((m) => m.id === replace.newId)
			? replace.oldId
			: undefined
	const kept = raidMembers.filter((member) => member.id !== leavingId)

	// Mirrored layouts keep the two drives of a pair next to each other. umbreld lists a pair
	// that is having a drive replaced with only its other drive, so the replacement is put back
	// beside it.
	let ordered = kept
	const mirrors = raid.topology === 'mirror' ? (raid.mirrors ?? []) : []
	if (mirrors.length > 0) {
		const inMirrors = new Set(mirrors.flat())
		const spare = kept.filter((member) => !inMirrors.has(member.id))
		const byId = (id: string) => kept.find((member) => member.id === id)
		const pairs: RaidMember[] = []
		for (const mirror of mirrors) {
			const listed = mirror.map(byId).filter((member): member is RaidMember => !!member)
			if (listed.length === 1 && spare.length > 0) {
				const index = Math.max(
					0,
					spare.findIndex((member) => member.id === replace?.newId),
				)
				listed.push(spare.splice(index, 1)[0])
			}
			pairs.push(...listed)
		}
		ordered = [...pairs, ...spare]
	}

	const toMember = (member: RaidMember): Member => {
		const added = record?.kind === 'add' && record.id === member.id
		if (rebuilding && replace?.newId === member.id) return {id: member.id, state: 'rebuilding'}
		if (running && progress.type === 'expansion' && added) return {id: member.id, state: 'joining'}
		return {id: member.id, state: memberState(member, deviceOf(member.id))}
	}
	const members = ordered.map(toMember)
	const accel = accelMembers.map(toMember)

	const memberOf = (id: string) => [...raidMembers, ...accelMembers].find((member) => member.id === id)
	const present = attached.map((device) => toDrive(device, memberOf(device.id)))
	const gone = [
		...raidMembers
			.filter((member) => !deviceOf(member.id))
			.map((member) => missingDrive(member.id, kind, (member as {size?: number}).size)),
		...accelMembers.filter((member) => !deviceOf(member.id)).map((member) => missingDrive(member.id, 'ssd', undefined)),
	]
	const drives = [...present, ...gone]

	// What umbreld measures: the file system's own numbers, with the acceleration SSDs' share
	// taken out, since that is acceleration and not storage
	const special = raid.accelerator?.exists ? (raid.accelerator.specialSize ?? 0) : 0
	const usable = Math.max(0, (raid.usableSpace ?? 0) - special)
	const sizeOf = (id: string) => deviceOf(id)?.roundedSize
	let unused = 0
	if (raid.raidType === 'failsafe' && raid.topology === 'raidz') {
		const sizes = raidMembers.map((member) => sizeOf(member.id)).filter((size): size is number => !!size)
		if (sizes.length > 1) unused = sizes.reduce((sum, size) => sum + size - Math.min(...sizes), 0)
	}
	if (raid.topology === 'mirror') {
		for (const mirror of mirrors) {
			const sizes = mirror.map(sizeOf).filter((size): size is number => !!size)
			if (sizes.length > 1) unused += sizes.reduce((sum, size) => sum + size - Math.min(...sizes), 0)
		}
	}
	let protection = 0
	if (raid.raidType === 'failsafe' && raid.totalSpace && raid.usableSpace) {
		protection =
			raid.topology === 'mirror'
				? Math.max(0, raid.totalSpace - usable - unused)
				: Math.max(0, raid.totalSpace - raid.usableSpace)
	}

	const isMember = (id: string) => [...members, ...accel].some((member) => member.id === id)
	const partial =
		raid.raidType === 'storage' && raid.topology === 'mirror'
			? mirrors.filter((mirror): mirror is [string, string] => mirror.length === 2)
			: null

	return {
		device: isPro ? 'pro' : 'other',
		drives: isPro ? placeMissing(drives) : drives,
		pool: {
			kind,
			layout,
			members,
			accel,
			used: raid.usedSpace ?? 0,
			reported: raid.usableSpace ? {usable, protection, unused} : undefined,
			unavailable: !isUp(raid.status) || undefined,
			// Errors a storage check couldn't repair are damaged data, whichever number carries them
			dataErrors: Math.max(raid.dataErrors ?? 0, raid.scrub?.state === 'finished' ? raid.scrub.errors : 0),
			partialPairs: partial,
			accelRoom: special > 0 ? special : undefined,
			accelUsed:
				special > 0 && raid.accelerator?.specialFreeSpace !== undefined
					? Math.min(1, Math.max(0, 1 - raid.accelerator.specialFreeSpace / special))
					: undefined,
		},
		op: toOperation(progress, layout, record, isMember, (id) => !!deviceOf(id)),
		// A switch that stopped part way has its own state, and umbreld's sentence for it isn't shown
		failsafeError: partial ? null : (failsafeError ?? null),
		finished: finished ?? null,
	}
}

// ---------------------------------------------------------------------------
// Storage that can't start, and storage that can't be read
// ---------------------------------------------------------------------------

// Before login umbreld only says which drives the storage is built from and whether each
// answered. Either answer can fail on its own, and what wasn't answered isn't guessed: a drive
// is only called missing when the list of drives arrived without it, and only called a spare
// when the list of the storage's drives arrived without it.
export function toStartFailureDrives({
	members,
	membersKnown,
	devices,
	devicesKnown,
	isPro,
}: {
	members: {name: string; isOk: boolean}[]
	// False when the check of the storage's drives itself failed
	membersKnown: boolean
	devices: StorageDevice[]
	// False when the drives in the machine couldn't be listed
	devicesKnown: boolean
	isPro: boolean
}): StartFailureDrive[] {
	const attached = devices.filter(withId)
	const memberIds = new Set(members.map((member) => member.name))
	const memberDevices = attached.filter((device) => memberIds.has(device.id))
	// What a drive that can't be seen most likely is: what the drives that are still there are
	const kind: DriveKind =
		isPro || (memberDevices.length > 0 && memberDevices.every((device) => device.type === 'ssd')) ? 'ssd' : 'hdd'
	const entries: StartFailureDrive[] = [
		...members.map((member): StartFailureDrive => {
			const device = attached.find((candidate) => candidate.id === member.name)
			const drive = device
				? toDrive(device)
				: {...missingDrive(member.name, kind, undefined), absent: devicesKnown || undefined}
			return {drive, member: {responding: member.isOk}}
		}),
		...attached
			.filter((device) => !memberIds.has(device.id) && !device.isSystemDrive)
			.map((device): StartFailureDrive => ({drive: toDrive(device), member: membersKnown ? undefined : {}})),
	]
	if (!isPro) return entries
	const placed = placeMissing(entries.map((entry) => entry.drive))
	return entries.map((entry, index) => ({...entry, drive: placed[index]}))
}
