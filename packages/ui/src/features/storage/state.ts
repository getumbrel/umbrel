// The storage as Storage Manager sees it, and everything that can be worked out from it:
// whether the data is protected, what a new drive can be used for, how FailSafe can be
// turned on, and how a drive can be taken out.
//
// StorageState is built from hardware.raid.getStatus and hardware.internalStorage.getDevices
// (see from-umbreld.ts). The storage lab builds the same shape from a pretend umbreld, so
// every screen can be opened in every state.
//
// How it lines up with umbreld:
//   member 'online'      device status ONLINE, or DEGRADED (still in use: the drive is marked degraded)
//   member 'missing'     any other status, and no matching drive in the device list
//   member 'unusable'    any other status with the drive attached: it can be rebuilt where it is
//   member 'failed'      the same, with the drive failing its own health check: it has to be replaced
//   member 'rebuilding'  being resilvered: replace or rebuild in progress
//   member 'joining'     expansion in progress
//   op 'failsafe'        failsafeTransitionStatus: syncing, rebooting, rebuilding
//   op 'check'           scrub in progress
//   pool.dataErrors      dataErrors, and the errors the last storage check couldn't repair
//   pool.partialPairs    raidType 'storage' with a mirror topology: a switch that stopped part way
//
// umbreld says that a rebuild, an expansion or a switch is running and how far along it is,
// not which drives it involves. Only the session that started it knows, so every drive-level
// detail of a task is optional.
//
// Nothing here is worded: results are facts and reasons, and the screens phrase them.

import {
	Capacity,
	DeviceModel,
	Drive,
	DriveKind,
	FailsafeLayout,
	failsafeLayoutsFor,
	getCapacity,
	isFailing,
	Layout,
	MAX_HDD_RAIDZ1_DRIVES,
	parityOf,
	survives,
	troubleOf,
} from './model'

export type MemberState = 'online' | 'failed' | 'missing' | 'unusable' | 'rebuilding' | 'joining'
export type Member = {id: string; state: MemberState}

export type Operation =
	// `oldId` is the drive being replaced while it is still connected: a working drive stays
	// part of the storage until its replacement holds everything
	| {kind: 'rebuild'; progress: number; memberId?: string; oldId?: string}
	| {kind: 'expand'; progress: number; memberId?: string}
	| {
			kind: 'failsafe'
			// Copying to the new drives, the restart, then the original drive is added.
			// Mirrored pairs have one phase, 'rebuilding': each drive is copied to its pair.
			phase: 'copying' | 'restarting' | 'rebuilding'
			// Of the whole switch, as umbreld reports it: the restart sits at 50
			progress: number
			// The level being switched to. umbreld's status only shows it once the restart has happened.
			to?: FailsafeLayout
			// The drives being brought in. Until the restart they aren't members of the storage; after
			// it, and for mirrored pairs from the start, they are.
			newIds?: string[]
			accelId?: string
	  }
	| {kind: 'check'; progress: number}

export type StorageState = {
	device: DeviceModel
	// Every drive umbrelOS knows about: the storage's members, its acceleration SSDs, new
	// drives, and on other hardware the drive umbrelOS itself runs from
	drives: Drive[]
	pool: {
		kind: DriveKind
		layout: Layout
		// Mirrored layouts keep the two drives of a pair next to each other: [0, 1], [2, 3]...
		members: Member[]
		accel: Member[]
		used: number
		// What umbreld measures, where it measures it: the file system's own numbers differ a
		// little from the drives' nominal sizes. Without them the numbers are worked out from the drives.
		reported?: {usable: number; protection: number; unused: number}
		// umbreld says the storage isn't running, whatever the drives look like
		unavailable?: boolean
		dataErrors: number
		// FailSafe was only partly turned on: these members got their pair, the rest didn't.
		// With every member paired, it is the acceleration SSD that was left without one.
		partialPairs: [string, string][] | null
		// The part of the acceleration SSDs that holds small files: its size, and how full it is (0 to 1)
		accelRoom?: number
		accelUsed?: number
	}
	op: Operation | null
	// What umbreld reports when turning on FailSafe didn't finish
	failsafeError: string | null
	// A task seen finishing while Storage Manager was open. umbreld keeps no record of when a
	// task ended, so this can't be shown later.
	finished?: {kind: Exclude<Operation['kind'], 'check'>; at: number} | null
}

// What the screens ask umbreld to do
export type StorageAction =
	| {type: 'replace'; memberId: string; newId: string}
	// The same drive, erased and rebuilt where it is
	| {type: 'repair'; memberId: string}
	| {type: 'add'; id: string}
	| {type: 'addPair'; ids: [string, string]}
	| {type: 'addAccel'; ids: string[]}
	| {type: 'failsafe'; to: 'raidz1' | 'raidz2'; newIds: string[]; accelId?: string}
	| {type: 'failsafe'; to: 'mirror'; pairs: {existingId: string; newId: string}[]; accelId?: string}
	| {type: 'check'}

// Where a switch to FailSafe has got to, and how far along that step is. umbreld reports one
// number for the whole switch with the restart at 50: the copy is the first half, the original
// drive being added is the second. Mirrored pairs are one step with no restart.
export function failsafeStep(op: Extract<Operation, {kind: 'failsafe'}>): {step: 0 | 1 | 2 | null; progress?: number} {
	if (op.to === 'mirror') return {step: null, progress: op.progress}
	if (op.phase === 'copying') return {step: 0, progress: Math.min(100, op.progress * 2)}
	if (op.phase === 'restarting') return {step: 1}
	return {step: 2, progress: Math.max(0, Math.min(100, (op.progress - 50) * 2))}
}

// How far along the task is, as the one number shown for it
export function taskProgress(op: Operation): number | undefined {
	return op.kind === 'failsafe' ? failsafeStep(op).progress : op.progress
}

// Whether a switch to FailSafe is writing to this drive right now, when it's known which
// drives it brought in: the new drives while everything is copied to them, then the original
// drive once the restart has happened
export function isSwitchTarget(state: StorageState, id: string): boolean {
	const op = state.op
	if (op?.kind !== 'failsafe' || !op.newIds || id === op.accelId) return false
	const {step} = failsafeStep(op)
	if (step === 1) return false
	if (step === 2) return !op.newIds.includes(id) && state.pool.members.some((member) => member.id === id)
	return op.newIds.includes(id)
}

export const isDown = (member: Member) =>
	member.state === 'failed' ||
	member.state === 'missing' ||
	member.state === 'unusable' ||
	member.state === 'rebuilding'

// Down, and nothing is being done about it yet
export const isBroken = (member: Member) =>
	member.state === 'failed' || member.state === 'missing' || member.state === 'unusable'

// FailSafe on the drives, with SSD Acceleration left on one SSD: a switch to FailSafe that
// stopped before that SSD got its mirror. It holds the index to every file, and nothing else
// holds a copy, so the storage is no safer than that one SSD. umbreld calls this 'storage'.
export const accelExposed = (state: StorageState) => state.pool.layout !== 'stripe' && state.pool.accel.length === 1

// ---------------------------------------------------------------------------
// Reading the storage
// ---------------------------------------------------------------------------

export type PoolStatus =
	// Too many drives are gone: the data can't be read
	| 'offline'
	// Still working, but one more failure loses the data
	| 'at-risk'
	// A drive is down and the storage can still lose another
	| 'reduced'
	| 'protected'
	// Full Storage: working, never protected
	| 'unprotected'

export type PoolView = {
	status: PoolStatus
	// How many more drives could fail right now without losing data
	spare: number
	capacity: Capacity
	free: number
	memberDrives: Drive[]
	accelDrives: Drive[]
	down: Member[]
	accelDown: Member[]
	// New drives, not part of anything yet
	loose: Drive[]
	// Drives a switch to FailSafe is bringing in: spoken for, but not members until it finishes.
	// When it isn't known which drives those are, every drive that could be one of them.
	incoming: Drive[]
	// The drive a replacement is taking over from, while it is still connected
	leaving?: Drive
	// How umbreld's measured space compares with the drives' nominal sizes. What a change would
	// give is worked out from the drives, then scaled by this so it matches what will be measured.
	scale: number
	// The drive umbrelOS runs from, on other hardware
	system?: Drive
	// Umbrel Pro only: how many of its four slots are empty
	freeSlots?: number
	driveOf: (id: string) => Drive | undefined
	stateOf: (id: string) => MemberState | undefined
}

export function viewPool(state: StorageState): PoolView {
	const {layout, members, accel, partialPairs} = state.pool
	const driveOf = (id: string) => state.drives.find((drive) => drive.id === id)
	const present = (drive: Drive | undefined): drive is Drive => !!drive
	const memberDrives = members.map((member) => driveOf(member.id)).filter(present)
	const accelDrives = accel.map((member) => driveOf(member.id)).filter(present)

	// A drive still joining doesn't hold anything yet
	const settledDrives = members
		.filter((member) => member.state !== 'joining')
		.map((member) => driveOf(member.id))
		.filter(present)
	const pairs: [Drive, Drive][] = []
	if (layout === 'mirror') {
		for (let i = 0; i + 1 < settledDrives.length; i += 2) pairs.push([settledDrives[i], settledDrives[i + 1]])
	}
	let capacity = getCapacity(layout, settledDrives, layout === 'mirror' ? pairs : undefined)

	// A switch that stopped part way: the drives that got a pair are mirrored, the rest are
	// plain storage. umbreld calls the whole of it 'storage' because not all of it is protected.
	if (partialPairs) {
		const paired = partialPairs
			.map(([a, b]) => [driveOf(a), driveOf(b)])
			.filter((pair): pair is [Drive, Drive] => !!pair[0] && !!pair[1])
		const inPairs = new Set(partialPairs.flat())
		const mirrored = getCapacity(
			'mirror',
			paired.flatMap((pair) => pair),
			paired,
		)
		const plain = getCapacity(
			'stripe',
			settledDrives.filter((drive) => !inPairs.has(drive.id)),
		)
		capacity = {
			usable: mirrored.usable + plain.usable,
			protection: mirrored.protection,
			unused: mirrored.unused,
			raw: mirrored.raw + plain.raw,
			shares: {...mirrored.shares, ...plain.shares},
			pairs: mirrored.pairs,
		}
	}

	const {reported} = state.pool
	const scale = reported && capacity.usable > 0 ? reported.usable / capacity.usable : 1
	if (reported) capacity = {...capacity, ...reported, raw: reported.usable + reported.protection + reported.unused}

	const down = members.filter(isDown)
	const accelDown = accel.filter(isDown)
	const downIds = [...down, ...accelDown].map((member) => member.id)

	let status: PoolStatus
	let spare = 0
	if (state.pool.unavailable || !survives(layout, settledDrives, capacity.pairs, downIds, accelDrives)) {
		status = 'offline'
	} else if (layout === 'stripe') {
		status = 'unprotected'
	} else {
		spare =
			layout === 'mirror'
				? capacity.pairs.some(([a, b]) => downIds.includes(a) || downIds.includes(b))
					? 0
					: 1
				: parityOf(layout) - down.length
		// The acceleration pair holds one copy each of what only it stores
		const exposed = accelExposed(state)
		if (accelDown.length > 0 || exposed) spare = 0
		if (down.length === 0 && accelDown.length === 0 && !exposed) status = 'protected'
		else status = spare === 0 ? 'at-risk' : 'reduced'
	}

	const inPool = new Set([...members, ...accel].map((member) => member.id))
	const leavingId = state.op?.kind === 'rebuild' ? state.op.oldId : undefined
	const outside = (drive: Drive) => !inPool.has(drive.id) && !drive.absent && !drive.system && drive.id !== leavingId
	// When this session didn't start the switch, which drives it is bringing in isn't known.
	// Until the restart makes them members, no new drive can be told apart from one of them.
	const switching = state.op?.kind === 'failsafe' ? state.op : null
	const incoming = !switching
		? []
		: switching.newIds
			? [...switching.newIds, ...(switching.accelId ? [switching.accelId] : [])]
					.map(driveOf)
					.filter(present)
					.filter(outside)
			: switching.phase === 'rebuilding'
				? []
				: state.drives.filter(
						(drive) =>
							outside(drive) && (drive.kind === state.pool.kind || (drive.kind === 'ssd' && accel.length === 1)),
					)
	const incomingIds = incoming.map((drive) => drive.id)
	return {
		status,
		spare,
		capacity,
		free: Math.max(0, capacity.usable - state.pool.used),
		memberDrives,
		accelDrives,
		down,
		accelDown,
		loose: state.drives.filter((drive) => outside(drive) && !incomingIds.includes(drive.id)),
		incoming,
		leaving: leavingId ? state.drives.find((drive) => drive.id === leavingId && !drive.absent) : undefined,
		scale,
		system: state.drives.find((drive) => drive.system),
		freeSlots:
			state.device === 'pro' ? 4 - state.drives.filter((drive) => drive.slot && !drive.absent).length : undefined,
		driveOf,
		stateOf: (id) => [...members, ...accel].find((member) => member.id === id)?.state,
	}
}

// How full the storage is, 0 to 1
export const fullness = (state: StorageState, view: PoolView) =>
	view.capacity.usable > 0 ? Math.min(1, state.pool.used / view.capacity.usable) : 0

export const NEARLY_FULL = 0.9

// Why something can't be done right now. The screens say it in words.
export type Blocked =
	// umbreld makes one change to the storage at a time
	| {why: 'busy'; task: Operation['kind']; progress: number}
	// Storage is one kind of drive
	| {why: 'wrong-kind'; poolKind: DriveKind}
	| {why: 'too-small'; size: number}
	// One-drive protection takes up to six hard drives
	| {why: 'limit'}
	// Mirrored storage grows a pair at a time
	| {why: 'needs-pair'}
	// Acceleration can't take more SSDs once it's on
	| {why: 'accel-on'}
	// Full Storage has its one SSD: a second joins when FailSafe is turned on
	| {why: 'accel-for-failsafe'}
	// FailSafe mirrors two acceleration SSDs
	| {why: 'accel-needs-two'}
	| {why: 'repair-first'}
	| {why: 'partly-on'}
	// The new drive is failing its own health check
	| {why: 'failing'}
	// Turning on FailSafe needs more drives than are attached
	| {why: 'needs-drives'; missing: Need[]; ssd?: number}

// A new drive something still needs, and how large it has to be
export type Need = {size: number; kind: DriveKind}

export function busyWith(state: StorageState): Extract<Blocked, {why: 'busy'}> | undefined {
	return state.op ? {why: 'busy', task: state.op.kind, progress: Math.floor(taskProgress(state.op) ?? 0)} : undefined
}

// The other drives a member leans on: its pair in a mirror, everyone else in RAID-Z, the
// other SSD for acceleration
function peersOf(state: StorageState, view: PoolView, id: string): Member[] {
	const {layout, members, accel} = state.pool
	if (accel.some((member) => member.id === id)) return accel.filter((member) => member.id !== id)
	if (layout === 'mirror') {
		const pair = view.capacity.pairs.find((candidate) => candidate.includes(id))
		return members.filter((member) => pair?.includes(member.id) && member.id !== id)
	}
	if (layout === 'stripe') return []
	return members.filter((member) => member.id !== id)
}

// Everything a member's data rests on is working. Before a working drive is taken out, its
// peers must also never have reported an error, since they are about to carry everything alone.
// A drive the storage has already let go of leaves them no worse off, and repairing it can be
// the only way forward, so old error counts don't stand in the way of that.
function peersAreSound(state: StorageState, view: PoolView, id: string, spotless: boolean): boolean {
	const peers = peersOf(state, view, id)
	return (
		peers.length > 0 &&
		peers.every((peer) => {
			const drive = view.driveOf(peer.id)
			if (peer.state !== 'online' || !drive || isFailing(drive) || drive.degraded) return false
			return !spotless || !drive.errors
		})
	)
}

const isAccelMember = (state: StorageState, id: string) => state.pool.accel.some((member) => member.id === id)

// The drives a member works with, where their size is known
export const peerDrives = (state: StorageState, view: PoolView, id: string): Drive[] =>
	peersOf(state, view, id)
		.map((peer) => view.driveOf(peer.id))
		.filter((drive): drive is Drive => !!drive && drive.size > 0)

// How large a drive has to be to take a member's place. Drives that protect each other are each
// used up to the size of the smallest, so that is all a replacement has to match: a 4TB drive
// can stand in for the 8TB one beside two of 4TB. A drive used whole has to be matched whole.
// A drive that is gone counts by the size the storage remembers for it, 0 when it has none.
export function neededSize(state: StorageState, view: PoolView, memberId: string): number {
	const own = view.driveOf(memberId)?.size ?? 0
	if (peersOf(state, view, memberId).length === 0) return own
	const sizes = [own, ...peerDrives(state, view, memberId).map((drive) => drive.size)].filter((size) => size > 0)
	return sizes.length > 0 ? Math.min(...sizes) : 0
}

// The new drives that could take a member's place, best first: ones with nothing wrong with
// them, then ones that run hot, are worn or have reported errors, then ones that fail their own
// health check. The smallest that fits leads each group, so larger drives are left for growing.
export function sparesFor(state: StorageState, view: PoolView, memberId: string): Drive[] {
	const kind = isAccelMember(state, memberId) ? 'ssd' : state.pool.kind
	const needed = neededSize(state, view, memberId)
	const rank = (drive: Drive) => (isFailing(drive) ? 2 : troubleOf(drive) ? 1 : 0)
	return view.loose
		.filter((drive) => drive.kind === kind && drive.size >= needed)
		.sort((a, b) => rank(a) - rank(b) || a.size - b.size)
}

// ---------------------------------------------------------------------------
// Turning on FailSafe later
// ---------------------------------------------------------------------------

export type FailsafeOption = {
	to: FailsafeLayout
	// One entry per new drive it takes: how large it has to be, the drive that fills it when
	// one is attached, and for mirrored pairs the drive it pairs with
	needs: (Need & {drive?: Drive; existingId?: string})[]
	// Usable space once it's on, when every need is met
	after: number
	// One- and two-drive protection: what the storage grows to as each further new drive is added afterwards
	later: number[]
}

export type FailsafePlan = {
	// Why FailSafe can never be turned on here
	impossible?: 'partly-on' | 'several-ssds'
	options: FailsafeOption[]
	// Storage that is accelerated by one SSD needs a second, to mirror it
	accel?: Need & {drive?: Drive}
}

// A single drive can become any level. Several hard drives can only be mirrored: each needs a
// new drive at least its own size (umbreld checks pair by pair). Several SSDs can't be
// protected at all without starting over.
export function getFailsafePlan(state: StorageState): FailsafePlan {
	const view = viewPool(state)
	const {kind, members, accel, layout} = state.pool
	if (layout !== 'stripe') return {options: []}
	if (state.pool.partialPairs) return {impossible: 'partly-on', options: []}
	if (kind === 'ssd' && members.length > 1) return {impossible: 'several-ssds', options: []}

	const spares = view.loose.filter((drive) => drive.kind === kind && !isFailing(drive)).sort((a, b) => a.size - b.size)

	// Largest existing drive first, each taking the smallest new drive that fits, which wastes least
	const pairUp = (): FailsafeOption => {
		const pool = [...spares]
		const needs = [...view.memberDrives]
			.sort((a, b) => b.size - a.size)
			.map((existing) => {
				const index = pool.findIndex((candidate) => candidate.size >= existing.size)
				const drive = index === -1 ? undefined : pool.splice(index, 1)[0]
				return {size: existing.size, kind, drive, existingId: existing.id}
			})
		const ready = needs.every((need) => need.drive)
		const pairs = needs.map((need): [Drive, Drive] => [
			view.driveOf(need.existingId)!,
			need.drive ?? view.driveOf(need.existingId)!,
		])
		return {
			to: 'mirror',
			needs,
			after: ready
				? getCapacity(
						'mirror',
						pairs.flatMap((pair) => pair),
						pairs,
					).usable * view.scale
				: 0,
			later: [],
		}
	}

	const single = view.memberDrives[0]
	const raidz = (to: 'raidz1' | 'raidz2'): FailsafeOption => {
		const fitting = spares.filter((drive) => drive.size >= single.size)
		const needs = Array.from({length: parityOf(to)}, (_, index) => ({size: single.size, kind, drive: fitting[index]}))
		const taken = needs.map((need) => need.drive).filter((drive): drive is Drive => !!drive)
		const ready = taken.length === needs.length
		const drives = [single, ...taken]
		// Any new drives left over can be added once it's on, one at a time
		const most = to === 'raidz1' && kind === 'hdd' ? MAX_HDD_RAIDZ1_DRIVES : Infinity
		const later: number[] = []
		if (ready) {
			const grown = [...drives]
			for (const extra of fitting.slice(needs.length)) {
				if (grown.length >= most) break
				grown.push(extra)
				later.push(getCapacity(to, grown).usable * view.scale)
			}
		}
		return {to, needs, after: ready ? getCapacity(to, drives).usable * view.scale : 0, later}
	}

	const options =
		members.length > 1 ? [pairUp()] : kind === 'hdd' ? [raidz('raidz1'), raidz('raidz2'), pairUp()] : [raidz('raidz1')]

	let accelNeed: FailsafePlan['accel']
	if (accel.length === 1) {
		const size = view.accelDrives[0]?.size ?? 0
		accelNeed = {
			size,
			kind: 'ssd',
			drive: view.loose
				.filter((drive) => drive.kind === 'ssd' && !isFailing(drive) && drive.size >= size)
				.sort((a, b) => a.size - b.size)[0],
		}
	}
	return {options, accel: accelNeed}
}

// What an option still lacks, as the reason it can't be chosen yet
export function failsafeBlocked(state: StorageState, plan: FailsafePlan, option: FailsafeOption): Blocked | undefined {
	const missing = option.needs.filter((need) => !need.drive).map(({size, kind}) => ({size, kind}))
	const ssd = plan.accel && !plan.accel.drive ? plan.accel.size : undefined
	if (missing.length > 0 || ssd !== undefined) return {why: 'needs-drives', missing, ssd}
	return busyWith(state)
}

export function failsafeAction(plan: FailsafePlan, option: FailsafeOption): StorageAction | undefined {
	if (option.needs.some((need) => !need.drive) || (plan.accel && !plan.accel.drive)) return undefined
	const accelId = plan.accel?.drive?.id
	if (option.to === 'mirror') {
		return {
			type: 'failsafe',
			to: 'mirror',
			pairs: option.needs.map((need) => ({existingId: need.existingId!, newId: need.drive!.id})),
			accelId,
		}
	}
	return {type: 'failsafe', to: option.to, newIds: option.needs.map((need) => need.drive!.id), accelId}
}

// ---------------------------------------------------------------------------
// Every mode FailSafe has
// ---------------------------------------------------------------------------

// Storage Manager lists every mode umbrelOS has, also the ones this storage can't have, so that
// nobody takes the mode they see for the only one there is. This is where each stands.
export type ModeStanding =
	// The mode the storage uses
	| 'current'
	// It can be turned on from here, perhaps once more drives are in: getFailsafePlan has the detail
	| 'offered'
	// Drives of this kind can have it, but only when the storage is set up again
	| 'reset'
	// It takes hard drives, and the storage is made of SSDs
	| 'hdd-only'

export type ModeEntry = {layout: FailsafeLayout; standing: ModeStanding}

export function getModes(state: StorageState, plan: FailsafePlan = getFailsafePlan(state)): ModeEntry[] {
	const {kind, layout} = state.pool
	const own = failsafeLayoutsFor(kind)
	// Hard drives have every mode there is
	return failsafeLayoutsFor('hdd').map((mode) => ({
		layout: mode,
		standing: !own.includes(mode)
			? 'hdd-only'
			: layout === mode
				? 'current'
				: layout === 'stripe' && plan.options.some((option) => option.to === mode)
					? 'offered'
					: 'reset',
	}))
}

// ---------------------------------------------------------------------------
// What new drives can be used for
// ---------------------------------------------------------------------------

export type OfferId = 'replace' | 'add' | 'pair' | 'failsafe' | 'accelerate'

// One thing the new drives of a kind can be used for
export type Offer = {
	id: OfferId
	// The drives it would take by default, and the ones there are to choose from
	drives: Drive[]
	choices: Drive[]
	// How many drives it takes at a time
	takes: number
	// Usable space afterwards, and for drives added one at a time, after each further one
	after?: number
	later?: number[]
	// Part of each default drive the storage wouldn't reach
	unused?: number
	// The member a replacement is for
	memberId?: string
	// The only drives there are for it fail their own health check
	lastResort?: boolean
	// It is the thing to do with these drives
	primary?: boolean
	// It can't be undone, and closes off FailSafe: several SSDs in Full Storage can never be
	// protected, and several hard drives can only be mirrored
	closes?: 'failsafe' | 'levels'
	blocked?: Blocked
}

// Everything the new drives of one kind can be used for, most useful first
export function getOffers(state: StorageState, kind: DriveKind): Offer[] {
	const view = viewPool(state)
	const {layout, members, accel} = state.pool
	const poolKind = state.pool.kind
	const drives = view.loose.filter((drive) => drive.kind === kind)
	if (drives.length === 0) return []
	const sound = drives.filter((drive) => !isFailing(drive))
	const busy = busyWith(state)
	// A storage check gives way to a repair, and to nothing else
	const busyForRepair = state.op && state.op.kind !== 'check' ? busy : undefined
	const smallest = view.memberDrives.length ? Math.min(...view.memberDrives.map((member) => member.size)) : 0
	const bySize = [...sound].sort((a, b) => a.size - b.size)

	// Taking the place of a member that is down comes before anything else. Healthy drives are
	// offered for it. With none, a drive that fails its own health check still is, since it
	// brings protection back for now.
	const replacement = (member: Member): Offer => {
		const fitting = sparesFor(state, view, member.id)
		const healthy = fitting.filter((drive) => !isFailing(drive))
		const choices = healthy.length > 0 ? healthy : fitting
		return {
			id: 'replace',
			drives: choices.slice(0, 1),
			choices,
			takes: 1,
			memberId: member.id,
			primary: true,
			lastResort: (choices.length > 0 && healthy.length === 0) || undefined,
			blocked: choices.length > 0 ? busyForRepair : {why: 'too-small', size: neededSize(state, view, member.id)},
		}
	}

	// An SSD beside hard drives can only ever accelerate them
	if (poolKind === 'hdd' && kind === 'ssd') {
		const needed = layout === 'stripe' ? 1 : 2
		const brokenAccel = view.accelDown.find(isBroken)
		if (brokenAccel) return [replacement(brokenAccel)]
		// A drive that is failing its health check isn't offered for anything else
		if (sound.length === 0) return [{id: 'add', drives: [], choices: [], takes: 1, blocked: {why: 'failing'}}]
		if (accel.length === 1 && layout === 'stripe') {
			return [{id: 'accelerate', drives: [], choices: [], takes: 1, blocked: {why: 'accel-for-failsafe'}}]
		}
		if (accel.length > 0) {
			return [{id: 'accelerate', drives: [], choices: [], takes: needed, blocked: {why: 'accel-on'}}]
		}
		// The largest two that match, since the pair is mirrored
		const largest = [...sound].sort((a, b) => b.size - a.size)
		let pick = largest.slice(0, needed)
		if (needed === 2) {
			for (let i = 0; i + 1 < largest.length; i++) {
				if (largest[i].size === largest[i + 1].size) {
					pick = [largest[i], largest[i + 1]]
					break
				}
			}
		}
		return [
			{
				id: 'accelerate',
				drives: pick,
				choices: largest,
				takes: needed,
				primary: true,
				blocked:
					busy ??
					(state.pool.partialPairs
						? {why: 'partly-on'}
						: view.status !== 'protected' && view.status !== 'unprotected'
							? {why: 'repair-first'}
							: sound.length < needed
								? {why: 'accel-needs-two'}
								: undefined),
			},
		]
	}

	if (kind !== poolKind) {
		return [{id: 'add', drives: [], choices: [], takes: 1, blocked: {why: 'wrong-kind', poolKind}}]
	}

	// Broken storage is repaired before it grows
	const broken = view.down.find(isBroken)
	if (broken) return [replacement(broken)]
	// A drive that is failing its health check isn't offered for anything else
	if (sound.length === 0) return [{id: 'add', drives: [], choices: [], takes: 1, blocked: {why: 'failing'}}]

	if (state.pool.partialPairs) {
		return [{id: 'add', drives: [], choices: [], takes: 1, blocked: {why: 'partly-on'}}]
	}

	if (layout === 'stripe') {
		const offers: Offer[] = []
		const plan = getFailsafePlan(state)
		if (!plan.impossible) {
			// The card and the sheet read the same plan, so they can't disagree
			const ready = plan.options.find((option) => !failsafeBlocked(state, plan, option))
			const first = ready ?? plan.options[0]
			offers.push({
				id: 'failsafe',
				drives: first.needs.map((need) => need.drive).filter((drive): drive is Drive => !!drive),
				choices: sound,
				takes: first.needs.length,
				after: ready?.after,
				primary: !!ready,
				blocked: ready ? undefined : failsafeBlocked(state, plan, first),
			})
		}
		const largest = [...sound].sort((a, b) => b.size - a.size)
		const sizes: number[] = []
		let total = view.capacity.usable
		for (const drive of largest) sizes.push((total += drive.size * view.scale))
		offers.push({
			id: 'add',
			drives: largest.slice(0, 1),
			choices: largest,
			takes: 1,
			after: sizes[0],
			later: sizes.slice(1),
			// One drive of Full Storage can still become any level of FailSafe. Two can't.
			closes: members.length === 1 ? (poolKind === 'ssd' ? 'failsafe' : 'levels') : undefined,
			blocked: busy,
		})
		return offers
	}

	if (layout === 'mirror') {
		const largest = [...sound].sort((a, b) => b.size - a.size)
		const pair = largest.slice(0, 2)
		return [
			{
				id: 'pair',
				drives: pair.length === 2 ? pair : [],
				choices: largest,
				takes: 2,
				after: pair.length === 2 ? view.capacity.usable + Math.min(pair[0].size, pair[1].size) * view.scale : undefined,
				unused: pair.length === 2 ? Math.abs(pair[0].size - pair[1].size) : undefined,
				primary: true,
				blocked: busy ?? (pair.length < 2 ? {why: 'needs-pair'} : undefined),
			},
		]
	}

	// One- and two-drive protection grow a drive at a time, each using the smallest drive's size
	const fitting = bySize.filter((drive) => drive.size >= smallest)
	const room =
		layout === 'raidz1' && poolKind === 'hdd' ? Math.max(0, MAX_HDD_RAIDZ1_DRIVES - members.length) : Infinity
	const steps = fitting.slice(0, room).map((_, index) => view.capacity.usable + smallest * (index + 1) * view.scale)
	return [
		{
			id: 'add',
			drives: fitting.slice(0, 1),
			choices: fitting,
			takes: 1,
			after: steps[0],
			later: steps.slice(1),
			unused: fitting[0] ? fitting[0].size - smallest : undefined,
			primary: true,
			blocked:
				busy ?? (room === 0 ? {why: 'limit'} : fitting.length === 0 ? {why: 'too-small', size: smallest} : undefined),
		},
	]
}

// The kinds of new drive there are, hard drives first
export const newDriveKinds = (view: PoolView): DriveKind[] =>
	(['hdd', 'ssd'] as const).filter((kind) => view.loose.some((drive) => drive.kind === kind))

export function offerAction(
	state: StorageState,
	offer: Offer,
	drives: Drive[] = offer.drives,
): StorageAction | undefined {
	if (drives.length < offer.takes) return undefined
	if (offer.id === 'replace') {
		return offer.memberId ? {type: 'replace', memberId: offer.memberId, newId: drives[0].id} : undefined
	}
	if (offer.id === 'add') return {type: 'add', id: drives[0].id}
	if (offer.id === 'pair') return {type: 'addPair', ids: [drives[0].id, drives[1].id]}
	if (offer.id === 'accelerate') return {type: 'addAccel', ids: drives.slice(0, offer.takes).map((drive) => drive.id)}
	return undefined
}

// ---------------------------------------------------------------------------
// Taking a drive out: replacing a failed one, or swapping a working one
// ---------------------------------------------------------------------------

export type SwapPlan =
	// Not now, and why
	| {kind: 'blocked'; reason: 'working' | 'busy' | 'leaned-on'; blocked?: Blocked}
	// A suitable drive is already in: `keepsOld` when both stay connected while the data moves.
	// `lastResort` when the only drive there is fails its own health check.
	| {kind: 'replace'; newId: string; keepsOld: boolean; lastResort?: boolean}
	// The drive is fine but the storage has lost track of it: erase it and rebuild it where it is
	| {kind: 'repair'}
	// The drive has to be changed by hand first:
	//   insert     the drive is gone, so there is nothing to take out: a new one goes in
	//   beside     put the new drive in while the old one stays, so the storage is never without it
	//   in-place   take the old drive out and put the new one where it was
	//   either     other hardware, where umbreld can't see whether a bay is free: beside if one is
	//   reset      no room for both and no protection: back up, reset, set up again, restore
	// `risky` when the drive is down and the others can't be counted on either, so it stays
	// connected for as long as there is room for the new one beside it
	| {kind: 'steps'; variant: StepsVariant; risky?: boolean}

export type StepsVariant = 'insert' | 'beside' | 'in-place' | 'either' | 'reset'

export function getSwapPlan(state: StorageState, memberId: string): SwapPlan {
	const view = viewPool(state)
	const {layout} = state.pool
	const memberState = view.stateOf(memberId)
	const spares = sparesFor(state, view, memberId)
	// A drive that fails its own health check is never chosen while there is another way
	const spare = spares.find((drive) => !isFailing(drive))
	const isPro = state.device === 'pro'

	// Nothing is advised about a drive that isn't part of the storage
	if (!memberState) return {kind: 'blocked', reason: 'leaned-on'}
	if (memberState === 'rebuilding' || memberState === 'joining') return {kind: 'blocked', reason: 'working'}

	// Repairs go ahead during a storage check (umbreld stops the check), but nothing else
	if (state.op && state.op.kind !== 'check') return {kind: 'blocked', reason: 'busy', blocked: busyWith(state)}

	// A drive that is gone, has failed, or that the storage has let go of holds nothing worth
	// keeping. A new drive with nothing wrong with it is the best home for its data. Failing
	// that, a drive that only lost its place can be erased and rebuilt where it is. Failing that,
	// a new drive that is worn or runs hot, and last of all one that fails its own health check:
	// it still brings protection back for now, and the sheet says what it is.
	if (memberState === 'unusable' || memberState === 'failed' || memberState === 'missing') {
		if (spare && !troubleOf(spare)) return {kind: 'replace', newId: spare.id, keepsOld: false}
		const sound = peersAreSound(state, view, memberId, false)
		if (memberState === 'unusable' && sound) return {kind: 'repair'}
		if (spare) return {kind: 'replace', newId: spare.id, keepsOld: false}
		if (spares[0]) return {kind: 'replace', newId: spares[0].id, keepsOld: false, lastResort: true}
		// With no drive to use, one has to be put in by hand. A drive that is gone leaves nothing
		// to take out.
		if (memberState === 'missing') return {kind: 'steps', variant: 'insert'}
		// A drive that is still connected holds nothing the others don't while they are in good
		// shape, so it comes out. When they aren't, it may hold what they can no longer give.
		if (sound) return {kind: 'steps', variant: 'in-place'}
		if (!isPro) return {kind: 'steps', variant: 'either', risky: true}
		return {kind: 'steps', variant: view.freeSlots ? 'beside' : 'in-place', risky: true}
	}

	// From here on the drive is working, and taking it out is a choice
	if (state.op) return {kind: 'blocked', reason: 'busy', blocked: busyWith(state)}
	const protectedHere = isAccelMember(state, memberId) ? state.pool.accel.length > 1 : layout !== 'stripe'

	if (protectedHere) {
		const everythingElseFine =
			view.down.length === 0 && view.accelDown.length === 0 && state.pool.dataErrors === 0 && !state.pool.partialPairs
		if (!everythingElseFine || !peersAreSound(state, view, memberId, true)) {
			return {kind: 'blocked', reason: 'leaned-on'}
		}
		if (spare) return {kind: 'replace', newId: spare.id, keepsOld: true}
		// Keeping the old drive in until the new one has its data means the storage is never
		// left without protection. That matters most for the drives people swap: failing or worn.
		if (!isPro) return {kind: 'steps', variant: 'either'}
		return {kind: 'steps', variant: view.freeSlots ? 'beside' : 'in-place'}
	}

	// Without protection the old drive has to stay until its data has been copied off it
	if (spare) return {kind: 'replace', newId: spare.id, keepsOld: true}
	if (isPro && view.freeSlots === 0) return {kind: 'steps', variant: 'reset'}
	return {kind: 'steps', variant: 'beside'}
}

// The member the status should talk about first when drives are in trouble
export function firstTroubled(state: StorageState, view: PoolView): Member | undefined {
	return [...state.pool.members, ...state.pool.accel].find(
		(member) => member.state === 'online' && troubleOf(view.driveOf(member.id)),
	)
}
