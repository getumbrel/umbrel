// Storage lab: a pretend umbreld for the Storage Manager mock.
//
// It keeps a StorageState in the shapes the real one has, so the screens are exercised the way
// umbreld exercises them: a switch to one- or two-drive protection copies to drives that aren't
// members yet, restarts at 50, then comes back with the new drives as members and the original
// being added. A switch to mirrored pairs makes every drive a member at once.
//
// `request` stands in for hardware.raid.*: it takes what the screens ask for and refuses what
// umbreld refuses, in umbreld's own words. `simReducer` is everything else: time passing, and
// the hardware events only the lab's Simulate menu can cause.

import {Drive, DriveKind, parityOf, placeMissing} from '@/features/storage/model'
import {Member, MemberState, Operation, StorageAction, StorageState, viewPool} from '@/features/storage/state'

import {conditions, makeDrive} from './fixtures'

export type Sim = StorageState

export type SimEvent =
	| {type: 'set'; sim: Sim}
	| {type: 'fail'; id: string}
	| {type: 'unplug'; id: string}
	| {type: 'corrupt'; id: string}
	| {type: 'replug'; id: string}
	| {type: 'insert'; kind: DriveKind; sizeTb: number}
	| {type: 'eject'; id: string}
	| {type: 'condition'; id: string; condition: keyof typeof conditions | 'ok'}
	| {type: 'damage'; errors: number}
	| {type: 'fill'; fraction: number}
	| {type: 'tick'; amount: number}
	| {type: 'finish'}
	| {type: 'forget'}

const healthy: Partial<Drive> = {smart: 'healthy', errors: undefined, degraded: undefined}

// Where an unplugged Umbrel Pro SSD was, so the lab can put it back there
const homeSlots = new Map<string, number>()

const settle = (member: Member): Member =>
	member.state === 'rebuilding' || member.state === 'joining' ? {...member, state: 'online'} : member

// What umbreld does at the restart of a switch to one- or two-drive protection: the new drives
// become the storage, and the original drive starts being added to them
function afterRestart(sim: Sim, op: Extract<Operation, {kind: 'failsafe'}>): Sim {
	const fresh: Member[] = (op.newIds ?? []).map((id) => ({id, state: 'online'}))
	return {
		...sim,
		pool: {
			...sim.pool,
			layout: op.to ?? 'raidz1',
			members: [...fresh, ...sim.pool.members],
			accel: op.accelId ? [...sim.pool.accel, {id: op.accelId, state: 'online'}] : sim.pool.accel,
		},
		op: {...op, phase: 'rebuilding', progress: 50},
	}
}

function finishOperation(sim: Sim): Sim {
	const op = sim.op
	if (!op) return sim
	const at = Date.now()

	if (op.kind === 'check') return {...sim, op: null}

	if (op.kind === 'rebuild') {
		return {
			...sim,
			op: null,
			finished: {kind: 'rebuild', at},
			pool: {...sim.pool, members: sim.pool.members.map(settle), accel: sim.pool.accel.map(settle)},
		}
	}

	if (op.kind === 'expand') {
		// Files written before the drive was added keep their old share of protection, so they take
		// a little more of the bigger storage than they will once they have been rewritten
		const parity = parityOf(sim.pool.layout)
		const after = sim.pool.members.length
		const before = after - 1
		const overstated = (after - parity) / after / ((before - parity) / before)
		return {
			...sim,
			op: null,
			finished: {kind: 'expand', at},
			pool: {...sim.pool, members: sim.pool.members.map(settle), used: sim.pool.used * overstated},
		}
	}

	if (op.to !== 'mirror' && op.phase === 'copying') return {...sim, op: {...op, phase: 'restarting', progress: 50}}
	if (op.to !== 'mirror' && op.phase === 'restarting') return afterRestart(sim, op)
	return {...sim, op: null, failsafeError: null, finished: {kind: 'failsafe', at}}
}

export function simReducer(sim: Sim, event: SimEvent): Sim {
	const setMember = (id: string, state: MemberState): Sim['pool'] => ({
		...sim.pool,
		members: sim.pool.members.map((member) => (member.id === id ? {...member, state} : member)),
		accel: sim.pool.accel.map((member) => (member.id === id ? {...member, state} : member)),
	})
	const setDrive = (id: string, change: Partial<Drive>) =>
		sim.drives.map((drive) => (drive.id === id ? {...drive, ...change} : drive))

	switch (event.type) {
		case 'set':
			return event.sim

		case 'fail':
			return {...sim, pool: setMember(event.id, 'failed'), drives: setDrive(event.id, conditions.failing)}

		case 'unplug': {
			// The slot goes with the SSD: umbreld only knows it for an SSD it can see
			const drive = sim.drives.find((candidate) => candidate.id === event.id)
			if (drive?.slot) homeSlots.set(drive.id, drive.slot)
			const drives = setDrive(event.id, {absent: true})
			return {
				...sim,
				pool: setMember(event.id, 'missing'),
				drives: sim.device === 'pro' ? placeMissing(drives) : drives,
			}
		}

		case 'corrupt':
			return {...sim, pool: setMember(event.id, 'unusable'), drives: setDrive(event.id, healthy)}

		case 'replug': {
			const drive = sim.drives.find((candidate) => candidate.id === event.id)
			const slot = drive?.absent ? (homeSlots.get(event.id) ?? drive.slot) : drive?.slot
			const drives = setDrive(event.id, {absent: false, slot, ...healthy})
			return {...sim, pool: setMember(event.id, 'online'), drives: sim.device === 'pro' ? placeMissing(drives) : drives}
		}

		case 'insert': {
			const takenSlots = sim.drives.filter((drive) => !drive.absent).map((drive) => drive.slot)
			const slot = sim.device === 'pro' ? [1, 2, 3, 4].find((candidate) => !takenSlots.includes(candidate)) : undefined
			if (sim.device === 'pro' && !slot) return sim
			return {...sim, drives: [...sim.drives, makeDrive(event.kind, event.sizeTb, {slot})]}
		}

		case 'eject':
			return {...sim, drives: sim.drives.filter((drive) => drive.id !== event.id)}

		case 'condition': {
			const drive = sim.drives.find((candidate) => candidate.id === event.id)
			if (!drive) return sim
			// Back to what a fresh drive of its kind reports, then the one thing that is wrong
			const fresh = makeDrive(drive.kind, 1)
			const reset: Partial<Drive> = {
				...healthy,
				temperature: fresh.temperature,
				lifetimeUsed: drive.lifetimeUsed === undefined ? undefined : fresh.lifetimeUsed,
			}
			return {
				...sim,
				drives: setDrive(event.id, {...reset, ...(event.condition === 'ok' ? {} : conditions[event.condition])}),
			}
		}

		case 'damage':
			return {...sim, pool: {...sim.pool, dataErrors: event.errors}}

		case 'fill':
			return {...sim, pool: {...sim.pool, used: viewPool(sim).capacity.usable * event.fraction}}

		case 'tick': {
			const op = sim.op
			if (!op) return sim
			if (op.kind === 'failsafe' && op.to !== 'mirror') {
				// One number for the whole switch, as umbreld reports it, with the restart at 50
				if (op.phase === 'restarting') return sim
				const progress = op.progress + event.amount / 2
				if (op.phase === 'copying' && progress >= 50) return finishOperation(sim)
				if (progress >= 100) return finishOperation(sim)
				return {...sim, op: {...op, progress}}
			}
			const progress = op.progress + event.amount
			if (progress >= 100) return finishOperation(sim)
			return {...sim, op: {...op, progress}}
		}

		case 'finish': {
			let next = sim
			// A switch has up to three phases to get through
			for (let step = 0; step < 3 && next.op; step++) next = finishOperation(next)
			return next
		}

		// The moment a finished task gets is only shown while Storage Manager stays open
		case 'forget':
			return {...sim, finished: null}
	}
}

// The restart is the one step that isn't progress: the lab ends it after a moment
export const restarted = (sim: Sim): Sim =>
	sim.op?.kind === 'failsafe' && sim.op.phase === 'restarting' ? finishOperation(sim) : sim

// ---------------------------------------------------------------------------
// What the screens ask for
// ---------------------------------------------------------------------------

const refuse = (message: string): never => {
	throw new Error(message)
}

// umbreld makes one change to the storage at a time, and says which one is in the way
function assertIdle(sim: Sim, doing: string) {
	const op = sim.op
	if (!op) return
	if (op.kind === 'check') refuse(`Cannot ${doing} while a RAID scrub is in progress`)
	if (op.kind === 'failsafe') refuse('Already transitioning to failsafe mode')
	if (op.kind === 'expand') refuse(`Cannot ${doing} while a RAID expansion is in progress`)
	refuse(`Cannot ${doing} while a RAID rebuild is in progress`)
}

export function request(sim: Sim, action: StorageAction): Sim {
	const online = (id: string): Member => ({id, state: 'online'})
	const driveOf = (id: string) => sim.drives.find((drive) => drive.id === id)
	const setMember = (id: string, state: MemberState): Sim['pool'] => ({
		...sim.pool,
		members: sim.pool.members.map((member) => (member.id === id ? {...member, state} : member)),
		accel: sim.pool.accel.map((member) => (member.id === id ? {...member, state} : member)),
	})

	switch (action.type) {
		case 'replace': {
			// A storage check doesn't stand in the way: umbreld stops it so the repair can start
			if (sim.op && sim.op.kind !== 'check') refuse('Cannot replace a device while a RAID rebuild is in progress')
			if (!driveOf(action.newId)) refuse(`New device not found: /dev/disk/by-umbrel-id/${action.newId}`)
			const old = [...sim.pool.members, ...sim.pool.accel].find((member) => member.id === action.memberId)
			if (!old) refuse(`Device ${action.memberId} is not in the RAID array or accelerator`)
			const swap = (member: Member): Member =>
				member.id === action.memberId ? {id: action.newId, state: 'rebuilding'} : member
			// A working drive stays connected, and needed, until the new one holds everything
			const keeps = old?.state === 'online'
			return {
				...sim,
				finished: null,
				drives: keeps ? sim.drives : sim.drives.filter((drive) => drive.id !== action.memberId || !drive.absent),
				pool: {...sim.pool, members: sim.pool.members.map(swap), accel: sim.pool.accel.map(swap)},
				op: {kind: 'rebuild', progress: 0, memberId: action.newId, oldId: keeps ? action.memberId : undefined},
			}
		}

		case 'repair': {
			if (sim.op && sim.op.kind !== 'check') refuse('Cannot replace a device while a RAID rebuild is in progress')
			const member = [...sim.pool.members, ...sim.pool.accel].find((candidate) => candidate.id === action.memberId)
			if (member?.state === 'online') refuse('Cannot replace a healthy device with itself')
			return {
				...sim,
				finished: null,
				pool: setMember(action.memberId, 'rebuilding'),
				op: {kind: 'rebuild', progress: 0, memberId: action.memberId},
			}
		}

		case 'add': {
			assertIdle(sim, 'add a RAID device')
			if (sim.pool.layout === 'mirror') refuse('addDevice is not supported for mirror arrays, use addMirror')
			if (sim.pool.layout === 'stripe') {
				return {...sim, finished: null, pool: {...sim.pool, members: [...sim.pool.members, online(action.id)]}}
			}
			return {
				...sim,
				finished: null,
				pool: {...sim.pool, members: [...sim.pool.members, {id: action.id, state: 'joining'}]},
				op: {kind: 'expand', progress: 0, memberId: action.id},
			}
		}

		case 'addPair': {
			assertIdle(sim, 'add a RAID mirror')
			if (sim.pool.layout !== 'mirror') refuse('addMirror is only supported for mirror arrays')
			return {...sim, finished: null, pool: {...sim.pool, members: [...sim.pool.members, ...action.ids.map(online)]}}
		}

		case 'addAccel': {
			assertIdle(sim, 'add a RAID accelerator')
			if (sim.pool.accel.length > 0) refuse('An accelerator already exists')
			const sizes = action.ids.map((id) => driveOf(id)?.size ?? 0)
			return {
				...sim,
				pool: {...sim.pool, accel: action.ids.map(online), accelRoom: Math.min(...sizes) * 0.5, accelUsed: 0.02},
			}
		}

		case 'failsafe': {
			if (sim.op?.kind === 'check') refuse('Cannot start a FailSafe transition while a RAID scrub is in progress')
			if (sim.op) refuse('Already transitioning to failsafe mode')
			if (sim.pool.layout !== 'stripe') refuse('Can only transition from storage mode')
			if (action.to === 'mirror') {
				// Every drive gets its pair at once, and the storage stays in use
				const members = sim.pool.members.flatMap((member) => {
					const pair = action.pairs.find((candidate) => candidate.existingId === member.id)
					if (!pair) refuse(`Missing mirror pair for existing device: ${member.id}`)
					return [member, online(pair!.newId)]
				})
				return {
					...sim,
					failsafeError: null,
					finished: null,
					pool: {
						...sim.pool,
						layout: 'mirror',
						members,
						accel: action.accelId ? [...sim.pool.accel, online(action.accelId)] : sim.pool.accel,
					},
					op: {
						kind: 'failsafe',
						phase: 'rebuilding',
						progress: 0,
						to: 'mirror',
						newIds: action.pairs.map((pair) => pair.newId),
						accelId: action.accelId,
					},
				}
			}
			if (sim.pool.members.length !== 1) refuse('Can only transition single-disk arrays')
			return {
				...sim,
				failsafeError: null,
				finished: null,
				op: {
					kind: 'failsafe',
					phase: 'copying',
					progress: 0,
					to: action.to,
					newIds: action.newIds,
					accelId: action.accelId,
				},
			}
		}

		case 'check':
			if (sim.op)
				refuse(`Cannot start a scrub while ${sim.op.kind === 'check' ? 'a scrub' : 'another operation'} is in progress`)
			return {...sim, op: {kind: 'check', progress: 0}}
	}
}
