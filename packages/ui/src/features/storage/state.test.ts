// The rules for changing a drive: which new drive takes a member's place, when a drive can be
// rebuilt where it is, and when one has to stay connected. These decide what is erased and
// what someone is told to pull out of a machine, so each is pinned down here.

import {expect, test} from 'vitest'

import {DeviceModel, Drive, DriveKind, Layout, TB} from './model'
import {getModes, getOffers, getSwapPlan, MemberState, neededSize, Operation, StorageState, viewPool} from './state'

type Spec = {
	kind?: DriveKind
	size?: number
	state?: MemberState
	// What is wrong with the drive itself
	smart?: Drive['smart']
	errors?: number
	degraded?: boolean
	slot?: number
}

function storage({
	device = 'other',
	layout,
	members,
	accel = [],
	loose = [],
	op = null,
	dataErrors = 0,
}: {
	device?: DeviceModel
	layout: Layout
	members: Record<string, Spec>
	accel?: Record<string, Spec> | never[]
	loose?: Record<string, Spec> | never[]
	op?: Operation | null
	dataErrors?: number
}): StorageState {
	const toDrive = ([id, spec]: [string, Spec]): Drive => ({
		id,
		kind: spec.kind ?? 'hdd',
		size: (spec.size ?? 8) * TB,
		model: 'Model',
		serial: id,
		smart: spec.smart ?? 'healthy',
		errors: spec.errors,
		degraded: spec.degraded,
		slot: spec.slot,
		absent: spec.state === 'missing' || undefined,
	})
	const entries = (group: Record<string, Spec> | never[]) => Object.entries(group) as [string, Spec][]
	return {
		device,
		drives: [...entries(members), ...entries(accel), ...entries(loose)].map(toDrive),
		pool: {
			kind: Object.values(members)[0]?.kind ?? 'hdd',
			layout,
			members: entries(members).map(([id, spec]) => ({id, state: spec.state ?? 'online'})),
			accel: entries(accel).map(([id, spec]) => ({id, state: spec.state ?? 'online'})),
			used: 0,
			dataErrors,
			partialPairs: null,
		},
		op,
		failsafeError: null,
	}
}

const failed: Spec = {state: 'failed', smart: 'unhealthy'}

test('a new drive with nothing wrong with it takes a failed member’s place', () => {
	const state = storage({layout: 'raidz1', members: {a: {}, b: failed, c: {}}, loose: {spare: {}}})
	expect(getSwapPlan(state, 'b')).toEqual({kind: 'replace', newId: 'spare', keepsOld: false})
})

test('a new drive is preferred to rebuilding the drive the storage let go of', () => {
	const state = storage({layout: 'raidz1', members: {a: {}, b: {state: 'unusable'}, c: {}}, loose: {spare: {}}})
	expect(getSwapPlan(state, 'b')).toEqual({kind: 'replace', newId: 'spare', keepsOld: false})
})

test('a healthy new drive is chosen ahead of a failing one, whatever their order', () => {
	const state = storage({
		layout: 'raidz1',
		members: {a: {}, b: failed, c: {}},
		loose: {failing: {smart: 'unhealthy'}, healthy: {}},
	})
	expect(getSwapPlan(state, 'b')).toMatchObject({kind: 'replace', newId: 'healthy'})
})

test('rebuilding a drive where it is comes before a new drive that fails its health check', () => {
	const state = storage({
		layout: 'raidz1',
		members: {a: {}, b: {state: 'unusable'}, c: {}},
		loose: {failing: {smart: 'unhealthy'}},
	})
	expect(getSwapPlan(state, 'b')).toEqual({kind: 'repair'})
	// The failing drive is offered for nothing else, and stays free
	expect(viewPool(state).loose.map((drive) => drive.id)).toEqual(['failing'])
})

test('a failing new drive is still offered when nothing else can bring protection back', () => {
	const state = storage({layout: 'raidz1', members: {a: {}, b: failed, c: {}}, loose: {failing: {smart: 'unhealthy'}}})
	expect(getSwapPlan(state, 'b')).toEqual({kind: 'replace', newId: 'failing', keepsOld: false, lastResort: true})
	const [offer] = getOffers(state, 'hdd')
	expect(offer).toMatchObject({id: 'replace', memberId: 'b', lastResort: true})
	expect(offer.drives.map((drive) => drive.id)).toEqual(['failing'])
})

test('a failing new drive can’t be added to grow a storage that is in good shape', () => {
	const state = storage({layout: 'raidz1', members: {a: {}, b: {}, c: {}}, loose: {failing: {smart: 'unhealthy'}}})
	expect(getOffers(state, 'hdd')).toMatchObject([{blocked: {why: 'failing'}}])
})

test('a replacement only has to match the smallest drive it will work with', () => {
	// The 8TB drive beside two of 4TB was only ever used up to 4TB
	const state = storage({
		layout: 'raidz1',
		members: {a: {size: 4}, b: {size: 4}, big: {size: 8, ...failed}},
		loose: {spare: {size: 4}},
	})
	expect(neededSize(state, viewPool(state), 'big')).toBe(4 * TB)
	expect(getSwapPlan(state, 'big')).toMatchObject({kind: 'replace', newId: 'spare'})
})

test('a mirrored drive is matched against its own pair, not the whole storage', () => {
	const state = storage({
		layout: 'mirror',
		members: {a: {size: 8}, b: {size: 8, ...failed}, c: {size: 4}, d: {size: 4}},
		loose: {small: {size: 4}},
	})
	expect(neededSize(state, viewPool(state), 'b')).toBe(8 * TB)
	// Too small for the 8TB pair, so the drive has to be changed by hand
	expect(getSwapPlan(state, 'b')).toMatchObject({kind: 'steps'})
})

test('a drive used whole has to be matched whole', () => {
	const state = storage({layout: 'stripe', members: {a: {size: 4}, b: {size: 8}}, loose: {spare: {size: 4}}})
	expect(neededSize(state, viewPool(state), 'b')).toBe(8 * TB)
})

test('a drive is only rebuilt where it is when the others can carry it', () => {
	const unusable: Spec = {state: 'unusable'}
	// The others are in good shape
	expect(getSwapPlan(storage({layout: 'raidz1', members: {a: {}, b: unusable, c: {}}}), 'b')).toEqual({kind: 'repair'})
	// Errors the others once reported don't stand in the way: this can be the only way forward
	expect(getSwapPlan(storage({layout: 'raidz1', members: {a: {errors: 2}, b: unusable, c: {}}}), 'b')).toEqual({
		kind: 'repair',
	})
	// Another drive is failing its own health check
	expect(
		getSwapPlan(storage({layout: 'raidz1', members: {a: {smart: 'unhealthy'}, b: unusable, c: {}}}), 'b'),
	).toMatchObject({kind: 'steps', risky: true})
	// The storage no longer trusts another drive
	expect(
		getSwapPlan(storage({layout: 'raidz1', members: {a: {degraded: true}, b: unusable, c: {}}}), 'b'),
	).toMatchObject({kind: 'steps', risky: true})
	// Another drive is down too
	expect(getSwapPlan(storage({layout: 'raidz2', members: {a: failed, b: unusable, c: {}, d: {}}}), 'b')).toMatchObject({
		kind: 'steps',
		risky: true,
	})
})

test('a drive that fails its own health check is never rebuilt where it is', () => {
	const state = storage({layout: 'raidz1', members: {a: {}, b: failed, c: {}}})
	expect(getSwapPlan(state, 'b')).toEqual({kind: 'steps', variant: 'in-place'})
})

test('a drive the storage still uses is swapped, not repaired', () => {
	// Too many errors to trust, but still in use: erasing it would take away what it holds
	const state = storage({layout: 'raidz1', members: {a: {}, b: {degraded: true, errors: 40}, c: {}}})
	expect(getSwapPlan(state, 'b').kind).not.toBe('repair')
})

test('a drive that is gone leaves nothing to take out', () => {
	const state = storage({layout: 'raidz1', members: {a: {}, b: {state: 'missing'}, c: {}}})
	expect(getSwapPlan(state, 'b')).toEqual({kind: 'steps', variant: 'insert'})
	// Whatever shape the others are in, and while a storage check runs
	const worse = storage({
		layout: 'raidz1',
		members: {a: {smart: 'unhealthy'}, b: {state: 'missing'}, c: {errors: 3}},
		op: {kind: 'check', progress: 20},
	})
	expect(getSwapPlan(worse, 'b')).toEqual({kind: 'steps', variant: 'insert'})
})

test('a failed drive stays connected while the others can’t be counted on', () => {
	const members = {a: {smart: 'unhealthy' as const}, b: failed, c: {}}
	// Other hardware: beside it if there is a free bay
	expect(getSwapPlan(storage({layout: 'raidz1', members}), 'b')).toEqual({
		kind: 'steps',
		variant: 'either',
		risky: true,
	})
	// Umbrel Pro with a free slot: the new SSD goes in beside it
	const ssd = (slot: number, spec: Spec = {}): Spec => ({kind: 'ssd', slot, ...spec})
	const pro = storage({
		device: 'pro',
		layout: 'raidz1',
		members: {a: ssd(1, {smart: 'unhealthy'}), b: ssd(2, failed), c: ssd(3)},
	})
	expect(getSwapPlan(pro, 'b')).toEqual({kind: 'steps', variant: 'beside', risky: true})
	// Every slot taken: it has to come out, and the sheet says what that risks
	const full = storage({
		device: 'pro',
		layout: 'raidz1',
		members: {a: ssd(1, {smart: 'unhealthy'}), b: ssd(2, failed), c: ssd(3), d: ssd(4)},
	})
	expect(getSwapPlan(full, 'b')).toEqual({kind: 'steps', variant: 'in-place', risky: true})
})

test('nothing but a repair starts while the storage is busy', () => {
	const rebuilding: Operation = {kind: 'rebuild', progress: 30, memberId: 'c'}
	const state = storage({
		layout: 'raidz2',
		members: {a: {}, b: failed, c: {state: 'rebuilding'}, d: {}},
		loose: {spare: {}},
		op: rebuilding,
	})
	expect(getSwapPlan(state, 'b')).toMatchObject({kind: 'blocked', reason: 'busy'})
	expect(getSwapPlan(state, 'c')).toEqual({kind: 'blocked', reason: 'working'})
	// A storage check gives way to a repair
	const checking = storage({
		layout: 'raidz1',
		members: {a: {}, b: failed, c: {}},
		loose: {spare: {}},
		op: {kind: 'check', progress: 30},
	})
	expect(getSwapPlan(checking, 'b')).toMatchObject({kind: 'replace', newId: 'spare'})
	// and to nothing else
	expect(getSwapPlan(checking, 'a')).toMatchObject({kind: 'blocked', reason: 'busy'})
})

test('a working drive only comes out when everything else is in good shape', () => {
	const fine = storage({layout: 'raidz1', members: {a: {}, b: {}, c: {}}})
	expect(getSwapPlan(fine, 'a')).toEqual({kind: 'steps', variant: 'either'})
	// With a new drive already in, both stay connected while the data moves
	const ready = storage({layout: 'raidz1', members: {a: {}, b: {}, c: {}}, loose: {spare: {}}})
	expect(getSwapPlan(ready, 'a')).toEqual({kind: 'replace', newId: 'spare', keepsOld: true})

	const blocked = {kind: 'blocked', reason: 'leaned-on'}
	// Another drive is down
	expect(getSwapPlan(storage({layout: 'raidz2', members: {a: {}, b: failed, c: {}, d: {}}}), 'a')).toEqual(blocked)
	// Another drive once reported errors: it is about to carry everything alone
	expect(getSwapPlan(storage({layout: 'raidz1', members: {a: {}, b: {errors: 1}, c: {}}}), 'a')).toEqual(blocked)
	// Another drive is failing its health check
	expect(getSwapPlan(storage({layout: 'raidz1', members: {a: {}, b: {smart: 'unhealthy'}, c: {}}}), 'a')).toEqual(
		blocked,
	)
	// Data is already damaged
	expect(getSwapPlan(storage({layout: 'raidz1', members: {a: {}, b: {}, c: {}}, dataErrors: 1}), 'a')).toEqual(blocked)
})

test('a mirrored drive leans only on its own pair', () => {
	const state = storage({layout: 'mirror', members: {a: {}, b: {}, c: {}, d: {errors: 5}}})
	// Its pair is spotless, so it can come out
	expect(getSwapPlan(state, 'a').kind).toBe('steps')
	// Its pair has reported errors, so it can't
	expect(getSwapPlan(state, 'c')).toEqual({kind: 'blocked', reason: 'leaned-on'})
})

test('acceleration SSDs are their own group', () => {
	const ssd: Spec = {kind: 'ssd', size: 1}
	const state = storage({
		layout: 'raidz1',
		members: {a: {}, b: {}, c: {}},
		accel: {x: ssd, y: {...ssd, state: 'unusable'}},
		loose: {drive: {}},
	})
	// A hard drive can't take an SSD's place, and the other SSD can carry a repair
	expect(getSwapPlan(state, 'y')).toEqual({kind: 'repair'})
	const failing = storage({
		layout: 'raidz1',
		members: {a: {}, b: {}, c: {}},
		accel: {x: {...ssd, smart: 'unhealthy'}, y: {...ssd, state: 'unusable'}},
	})
	expect(getSwapPlan(failing, 'y')).toMatchObject({kind: 'steps', risky: true})
})

test('without protection a working drive stays until its data has been copied off', () => {
	const ssd = (slot: number): Spec => ({kind: 'ssd', slot})
	const room = storage({device: 'pro', layout: 'stripe', members: {a: ssd(1), b: ssd(2)}})
	expect(getSwapPlan(room, 'a')).toEqual({kind: 'steps', variant: 'beside'})
	// No slot for the new SSD and no second copy: only starting over swaps it
	const full = storage({device: 'pro', layout: 'stripe', members: {a: ssd(1), b: ssd(2), c: ssd(3), d: ssd(4)}})
	expect(getSwapPlan(full, 'a')).toEqual({kind: 'steps', variant: 'reset'})
})

test('nothing is advised about a drive that isn’t part of the storage', () => {
	const state = storage({layout: 'raidz1', members: {a: {}, b: {}, c: {}}, loose: {spare: {}}})
	expect(getSwapPlan(state, 'spare')).toEqual({kind: 'blocked', reason: 'leaned-on'})
	expect(getSwapPlan(state, 'nowhere')).toEqual({kind: 'blocked', reason: 'leaned-on'})
})

// Storage Manager lists every mode FailSafe has, whatever the storage is made of, and says of
// each one where it stands. A wrong word here tells someone their Umbrel can do less, or more,
// than it can.
const standings = (state: StorageState) =>
	Object.fromEntries(getModes(state).map((entry) => [entry.layout, entry.standing]))
const ssd: Spec = {kind: 'ssd', size: 4}

test('hard drives with FailSafe on could have had either other mode, by starting over', () => {
	const members = {a: {}, b: {}, c: {}, d: {}}
	expect(standings(storage({layout: 'raidz1', members}))).toEqual({raidz1: 'current', raidz2: 'reset', mirror: 'reset'})
	expect(standings(storage({layout: 'raidz2', members}))).toEqual({raidz1: 'reset', raidz2: 'current', mirror: 'reset'})
	expect(standings(storage({layout: 'mirror', members}))).toEqual({raidz1: 'reset', raidz2: 'reset', mirror: 'current'})
})

test('SSDs have one mode, and the other two are listed as taking hard drives', () => {
	const on = storage({device: 'pro', layout: 'raidz1', members: {a: ssd, b: ssd, c: ssd}})
	expect(standings(on)).toEqual({raidz1: 'current', raidz2: 'hdd-only', mirror: 'hdd-only'})
	// One SSD in Full Storage can still be given the one mode SSDs have
	const one = storage({device: 'pro', layout: 'stripe', members: {a: ssd}})
	expect(standings(one)).toEqual({raidz1: 'offered', raidz2: 'hdd-only', mirror: 'hdd-only'})
	// Several can't: umbreld has nothing to copy them from
	const several = storage({device: 'pro', layout: 'stripe', members: {a: ssd, b: ssd}})
	expect(standings(several)).toEqual({raidz1: 'reset', raidz2: 'hdd-only', mirror: 'hdd-only'})
})

test('one hard drive in Full Storage can be given any mode, several only pairs', () => {
	const one = storage({layout: 'stripe', members: {a: {}}})
	expect(standings(one)).toEqual({raidz1: 'offered', raidz2: 'offered', mirror: 'offered'})
	const several = storage({layout: 'stripe', members: {a: {}, b: {}, c: {}}})
	expect(standings(several)).toEqual({raidz1: 'reset', raidz2: 'reset', mirror: 'offered'})
})

test('every mode is listed once, in the order setup offers them', () => {
	for (const state of [
		storage({layout: 'raidz1', members: {a: ssd, b: ssd}}),
		storage({layout: 'stripe', members: {a: {}}}),
		storage({layout: 'mirror', members: {a: {}, b: {}}}),
	]) {
		expect(getModes(state).map((entry) => entry.layout)).toEqual(['raidz1', 'raidz2', 'mirror'])
	}
})
