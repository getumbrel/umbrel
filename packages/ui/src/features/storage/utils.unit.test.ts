import assert from 'node:assert/strict'
import test from 'node:test'

import type {RaidDevice, RaidStatus, StorageDevice} from './hooks/use-storage.ts'
import {
	canDisconnectPoolMember,
	canRepairInPlace,
	formatStorageSize,
	getPoolDeviceType,
	hasRaidErrors,
	planFailsafeTransition,
	planMirrorAdditions,
} from './utils.ts'

const TB = 1_000_000_000_000

function device(overrides: {id?: string; type?: 'hdd' | 'ssd'; roundedSize?: number}): StorageDevice {
	return {
		id: 'MODEL_SERIAL',
		type: 'hdd',
		roundedSize: 6 * TB,
		size: 6 * TB,
		isSystemDrive: false,
		...overrides,
	} as unknown as StorageDevice
}

function poolDrive(overrides: {id?: string; roundedSize?: number}): RaidDevice {
	return {
		id: 'POOL_MODEL_SERIAL',
		roundedSize: 6 * TB,
		status: 'ONLINE',
		...overrides,
	} as unknown as RaidDevice
}

const ids = (devices: Array<{id?: string}>) => devices.map((d) => d.id)

test('hasRaidErrors detects every non-zero ZFS device error counter', () => {
	assert.equal(hasRaidErrors(undefined), false)
	assert.equal(hasRaidErrors({readErrors: 0, writeErrors: 0, checksumErrors: 0}), false)
	assert.equal(hasRaidErrors({readErrors: 1, writeErrors: 0, checksumErrors: 0}), true)
	assert.equal(hasRaidErrors({readErrors: 0, writeErrors: 1, checksumErrors: 0}), true)
	assert.equal(hasRaidErrors({readErrors: 0, writeErrors: 0, checksumErrors: 1}), true)
})

test('getPoolDeviceType routes attached SSD and HDD pools to their matching manager', () => {
	const pool = {
		exists: true,
		devices: [{id: 'POOL', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
	} as RaidStatus

	assert.equal(getPoolDeviceType(pool, [device({id: 'POOL', type: 'ssd'})]), 'ssd')
	assert.equal(getPoolDeviceType(pool, [device({id: 'POOL', type: 'hdd'})]), 'hdd')
})

test('getPoolDeviceType uses topology hints when pool members are detached', () => {
	const detachedPool = {
		exists: true,
		devices: [{id: 'MISSING', status: 'UNAVAIL', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
	} as RaidStatus

	assert.equal(getPoolDeviceType({...detachedPool, topology: 'mirror'}, []), 'hdd')
	assert.equal(getPoolDeviceType({...detachedPool, topology: 'raidz'}, []), 'ssd')
	assert.equal(getPoolDeviceType({name: 'umbrel', exists: false}, []), undefined)
})

test('planMirrorAdditions pairs largest drives first, allowing mismatched sizes', () => {
	// Unlike the onboarding pairing, mirror additions accept unequal pairs - ZFS clamps
	// the mirror to its smaller member and the dialog explains the clamped capacity
	const {pairs, unpaired} = planMirrorAdditions([
		device({id: 'SMALL', roundedSize: 4 * TB}),
		device({id: 'BIG_A', roundedSize: 8 * TB}),
		device({id: 'BIG_B', roundedSize: 8 * TB}),
	])
	assert.deepEqual(
		pairs.map((pair) => ids(pair)),
		[['BIG_A', 'BIG_B']],
	)
	assert.deepEqual(ids(unpaired), ['SMALL'])

	const mismatched = planMirrorAdditions([
		device({id: 'BIG', roundedSize: 8 * TB}),
		device({id: 'SMALL', roundedSize: 4 * TB}),
	])
	assert.deepEqual(
		mismatched.pairs.map((pair) => ids(pair)),
		[['BIG', 'SMALL']],
	)
	assert.deepEqual(mismatched.unpaired, [])
})

test('planFailsafeTransition matches each pool drive with the smallest fitting candidate', () => {
	const plan = planFailsafeTransition({
		poolDrives: [poolDrive({id: 'POOL_BIG', roundedSize: 6 * TB}), poolDrive({id: 'POOL_SMALL', roundedSize: 4 * TB})],
		unpooledDrives: [
			device({id: 'SPARE_4', roundedSize: 4 * TB}),
			device({id: 'SPARE_8', roundedSize: 8 * TB}),
			device({id: 'SPARE_6', roundedSize: 6 * TB}),
		],
		unpooledSsds: [],
	})
	// Largest pool drive first, each taking the smallest candidate that fits - the 8TB
	// spare stays unused instead of being clamped
	assert.deepEqual(
		plan.pairs.map((pair) => [pair.existingDevice.id, pair.newDevice?.id]),
		[
			['POOL_BIG', 'SPARE_6'],
			['POOL_SMALL', 'SPARE_4'],
		],
	)
	assert.equal(plan.satisfied, true)
})

test('planFailsafeTransition reports unsatisfied pool drives with their required size', () => {
	const plan = planFailsafeTransition({
		poolDrives: [poolDrive({id: 'POOL', roundedSize: 6 * TB})],
		unpooledDrives: [device({id: 'TOO_SMALL', roundedSize: 4 * TB})],
		unpooledSsds: [],
	})
	assert.equal(plan.pairs[0].newDevice, undefined)
	assert.equal(plan.pairs[0].requiredSize, 6 * TB)
	assert.equal(plan.satisfied, false)
})

test('planFailsafeTransition requires a fitting SSD when the pool has an accelerator', () => {
	const base = {
		poolDrives: [poolDrive({id: 'POOL', roundedSize: 6 * TB})],
		unpooledDrives: [device({id: 'SPARE', roundedSize: 6 * TB})],
		acceleratorDevice: device({id: 'ACCEL', type: 'ssd', roundedSize: 1 * TB}),
	}

	const satisfied = planFailsafeTransition({
		...base,
		unpooledSsds: [
			device({id: 'SSD_BIG', type: 'ssd', roundedSize: 2 * TB}),
			device({id: 'SSD_FIT', type: 'ssd', roundedSize: 1 * TB}),
		],
	})
	// Smallest fitting SSD wins, larger one stays free
	assert.equal(satisfied.acceleratorNewDevice?.id, 'SSD_FIT')
	assert.equal(satisfied.acceleratorRequiredSize, 1 * TB)
	assert.equal(satisfied.satisfied, true)

	const missingSsd = planFailsafeTransition({...base, unpooledSsds: []})
	assert.equal(missingSsd.acceleratorNewDevice, undefined)
	assert.equal(missingSsd.satisfied, false)
})

function removalPool(overrides: Partial<RaidStatus> = {}): RaidStatus {
	return {
		name: 'umbrelos-test',
		exists: true,
		raidType: 'failsafe',
		status: 'ONLINE',
		topology: 'mirror',
		mirrors: [['A', 'B']],
		devices: ['A', 'B'].map((id) => ({id, status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0})),
		...overrides,
	}
}

test('physical swap never removes the surviving member of a degraded mirror', () => {
	const pool = removalPool({status: 'DEGRADED'})
	pool.devices![0].status = 'UNAVAIL'
	assert.equal(canDisconnectPoolMember(pool, 'B', [device({id: 'B'})]), false)
	assert.equal(canDisconnectPoolMember(pool, 'A', [device({id: 'B'})]), true)
})

test('physical swap requires known topology, member identity, and surviving physical inventory', () => {
	const pool = removalPool()
	const devices = ['A', 'B'].map((id) => device({id}))
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), true)
	assert.equal(canDisconnectPoolMember(pool, 'A', []), false)
	assert.equal(canDisconnectPoolMember(pool, 'C', devices), false)
	assert.equal(canDisconnectPoolMember({...pool, mirrors: undefined}, 'A', devices), false)
	assert.equal(canDisconnectPoolMember({...pool, raidType: 'storage'}, 'A', devices), false)
	assert.equal(canDisconnectPoolMember({...pool, status: 'FAULTED'}, 'A', devices), false)
	assert.equal(canDisconnectPoolMember(undefined, 'A', devices), false)
	assert.equal(canDisconnectPoolMember({...pool, dataErrors: 1}, 'A', devices), false)
})

test('RAIDZ and acceleration removal require their own surviving members', () => {
	const devices = ['A', 'B', 'SSD1', 'SSD2'].map((id) => device({id}))
	const pool = removalPool({topology: 'raidz', mirrors: undefined})
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), true)
	pool.devices![1].status = 'OFFLINE'
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
	const accelerator = {
		exists: true,
		devices: ['SSD1', 'SSD2'].map((id) => ({
			id,
			status: 'ONLINE' as const,
			readErrors: 0,
			writeErrors: 0,
			checksumErrors: 0,
		})),
	}
	assert.equal(canDisconnectPoolMember(removalPool({accelerator}), 'SSD1', devices), true)
	assert.equal(
		canDisconnectPoolMember(
			removalPool({accelerator: {...accelerator, devices: [accelerator.devices[0]]}}),
			'SSD1',
			devices,
		),
		false,
	)
})

test('unknown all-missing stripe media is not guessed to be SSD', () => {
	assert.equal(getPoolDeviceType(removalPool({topology: 'stripe'}), []), undefined)
})

test('swap guidance rejects an unhealthy survivor and malformed duplicate-member topology', () => {
	const pool = removalPool()
	const devices = ['A', 'B'].map((id) => device({id}))
	pool.devices![1].readErrors = 1
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
	pool.devices![1].readErrors = 0
	devices[1].smartStatus = 'unhealthy'
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
	pool.mirrors = [['A', 'A']]
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
})

test('old error counts on a survivor only block removing a drive that is still in use', () => {
	const pool = removalPool({status: 'DEGRADED'})
	const devices = ['A', 'B'].map((id) => device({id}))
	pool.devices![0].status = 'FAULTED'
	pool.devices![1].readErrors = 2
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), true, 'ZFS has already stopped using A')

	pool.devices![0].status = 'DEGRADED'
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)

	// A failing survivor still blocks it, whatever the state of the drive leaving
	pool.devices![0].status = 'FAULTED'
	devices[1].smartStatus = 'unhealthy'
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
})

test('known server-side work blocks removal before progress subscriptions catch up', () => {
	const devices = ['A', 'B'].map((id) => device({id}))
	for (const operation of [
		{rebuild: {state: 'rebuilding', progress: 12}},
		{expansion: {state: 'expanding', progress: 12}},
		{replace: {state: 'rebuilding', progress: 12}},
		{scrub: {state: 'scrubbing', progress: 12, errors: 0}},
		{failsafeTransitionStatus: {state: 'syncing', progress: 12}},
	] as Partial<RaidStatus>[])
		assert.equal(canDisconnectPoolMember(removalPool(operation), 'A', devices), false)
})

test('canRepairInPlace only erases a drive nothing depends on', () => {
	const member = (id: string, status: string) => ({id, status, readErrors: 0, writeErrors: 0, checksumErrors: 0})
	const failed = member('failed', 'UNAVAIL')
	const survivor = member('survivor', 'ONLINE')
	const pool = {
		exists: true,
		status: 'DEGRADED',
		raidType: 'failsafe',
		topology: 'raidz',
		devices: [failed, survivor],
	} as RaidStatus
	const attached = [device({id: 'failed'}), device({id: 'survivor'})]

	assert.equal(canRepairInPlace(pool, failed, attached), true)
	// It's already been let go of, and the other drive holds the data
	assert.equal(
		canRepairInPlace({...pool, devices: [failed, {...survivor, readErrors: 2}]} as RaidStatus, failed, attached),
		true,
		'old error counts on a survivor must not leave the user with no way forward',
	)
	assert.equal(canRepairInPlace({...pool, scrub: {state: 'scrubbing'}} as RaidStatus, failed, attached), true)

	// Not failed, or still in use
	assert.equal(canRepairInPlace(pool, {...failed, status: 'ONLINE'}, attached), false)
	assert.equal(canRepairInPlace(pool, {...failed, status: 'DEGRADED'}, attached), false)
	// Nothing to repair in place
	assert.equal(canRepairInPlace(pool, failed, [attached[1]]), false)
	// No other copy of the data
	assert.equal(canRepairInPlace({...pool, raidType: 'storage', topology: 'stripe'}, failed, attached), false)
	assert.equal(
		canRepairInPlace({...pool, devices: [failed, {...survivor, status: 'FAULTED'}]} as RaidStatus, failed, attached),
		false,
	)
	assert.equal(canRepairInPlace(pool, failed, [attached[0]]), false)
	// A failing drive stays out, wherever it is
	assert.equal(canRepairInPlace(pool, failed, [{...attached[0], smartStatus: 'unhealthy'}, attached[1]]), false)
	assert.equal(canRepairInPlace(pool, failed, [attached[0], {...attached[1], smartStatus: 'unhealthy'}]), false)
	// Another operation is still running
	assert.equal(
		canRepairInPlace({...pool, rebuild: {state: 'rebuilding', progress: 5}} as RaidStatus, failed, attached),
		false,
	)
})

test('canRepairInPlace treats a mirrored accelerator as its own group', () => {
	const member = (id: string, status: string) => ({id, status, readErrors: 0, writeErrors: 0, checksumErrors: 0})
	const failed = member('failed', 'UNAVAIL')
	const pool = {
		exists: true,
		status: 'ONLINE',
		raidType: 'storage',
		topology: 'stripe',
		devices: [member('data', 'ONLINE')],
		accelerator: {exists: true, devices: [failed, member('partner', 'ONLINE')]},
	} as RaidStatus
	const attached = [device({id: 'failed'}), device({id: 'partner'}), device({id: 'data'})]

	assert.equal(canRepairInPlace(pool, failed, attached), true)
	assert.equal(
		canRepairInPlace({...pool, accelerator: {exists: true, devices: [failed]}} as RaidStatus, failed, attached),
		false,
	)
})

test('formatStorageSize keeps one decimal below 100 and none above', () => {
	assert.equal(formatStorageSize(4_500_000_000_000), '4.5TB')
	assert.equal(formatStorageSize(45_240_000_000), '45.2GB')
	assert.equal(formatStorageSize(256_100_000_000), '256GB')
})

test('formatStorageSize moves up a unit instead of showing four digits', () => {
	assert.equal(formatStorageSize(999_600_000_000), '1TB')
	assert.equal(formatStorageSize(999_400_000_000), '999GB')
})
