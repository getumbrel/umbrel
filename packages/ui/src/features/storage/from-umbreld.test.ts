// How what umbreld reports is read into what the screens show. umbreld describes a storage in
// ZFS's terms and says little about a drive it can't see, so every reading that turns into a
// sentence on screen is pinned down here.

import {expect, test} from 'vitest'

import {missingDrive, recordOf, toHardware, toStartFailureDrives, toStorageState} from './from-umbreld'
import type {RaidProgress} from './hooks/use-raid-progress'
import type {RaidStatus, StorageDevice} from './hooks/use-storage'
import {GB, TB} from './model'
import {viewPool} from './state'

const device = (id: string, extra: Partial<StorageDevice> = {}): StorageDevice =>
	({
		id,
		type: 'hdd',
		transport: 'sata',
		device: 'sda',
		name: 'WDC WD80EFAX',
		model: 'WDC WD80EFAX',
		serial: id,
		size: 8_001_563_222_016,
		roundedSize: 8 * TB,
		smartStatus: 'healthy',
		isSystemDrive: false,
		...extra,
	}) as StorageDevice

const member = (id: string, status = 'ONLINE', extra: object = {}) => ({
	id,
	status,
	// The partition umbreld gave the storage: the drive's rounded size, less what it keeps aside
	size: 8 * TB - 115_343_360,
	readErrors: 0,
	writeErrors: 0,
	checksumErrors: 0,
	...extra,
})

const pool = (overrides: object = {}): RaidStatus =>
	({
		name: 'umbrelos',
		exists: true,
		raidType: 'failsafe',
		topology: 'raidz',
		raidzParity: 1,
		status: 'ONLINE',
		devices: [member('a'), member('b'), member('c')],
		totalSpace: 24 * TB,
		usableSpace: 16 * TB,
		usedSpace: 2 * TB,
		freeSpace: 14 * TB,
		dataErrors: 0,
		accelerator: {exists: false, devices: [], specialSize: 0, l2arcSize: 0},
		...overrides,
	}) as unknown as RaidStatus

const read = (raid: RaidStatus, devices: StorageDevice[], extra: object = {}) =>
	toStorageState({raid, devices, isPro: false, progress: null, record: null, ...extra})

const attached = [device('a'), device('b'), device('c')]
const states = (raid: RaidStatus, devices: StorageDevice[]) => read(raid, devices)!.pool.members

test('the level of protection is read from the layout umbreld reports', () => {
	expect(read(pool(), attached)!.pool.layout).toBe('raidz1')
	expect(read(pool({raidzParity: 2}), attached)!.pool.layout).toBe('raidz2')
	expect(read(pool({topology: 'mirror', mirrors: [['a', 'b']]}), attached)!.pool.layout).toBe('mirror')
	expect(read(pool({raidType: 'storage', topology: 'stripe'}), attached)!.pool.layout).toBe('stripe')
})

test('a switch that stopped part way reads as unprotected storage with the pairs it got', () => {
	// umbreld calls the whole of it 'storage', because not all of it is protected
	const state = read(pool({raidType: 'storage', topology: 'mirror', mirrors: [['a', 'b']]}), attached)!
	expect(state.pool.layout).toBe('stripe')
	expect(state.pool.partialPairs).toEqual([['a', 'b']])
	// Its own state says what happened, so umbreld's sentence for it isn't shown as well
	expect(state.failsafeError).toBeNull()
})

test('each drive is read as working, failed, unusable or gone', () => {
	// The storage has let go of a drive that is still there and healthy: it can be rebuilt
	expect(states(pool({devices: [member('a'), member('b', 'FAULTED'), member('c')]}), attached)[1].state).toBe(
		'unusable',
	)
	// The same, of a drive that fails its own health check
	const failing = [device('a'), device('b', {smartStatus: 'unhealthy'}), device('c')]
	expect(states(pool({devices: [member('a'), member('b', 'UNAVAIL'), member('c')]}), failing)[1].state).toBe('failed')
	// A drive the machine can't see
	expect(
		states(pool({devices: [member('a'), member('b', 'REMOVED'), member('c')]}), [attached[0], attached[2]])[1],
	).toEqual({id: 'b', state: 'missing'})
	// A drive the storage still uses but no longer trusts is working, and marked
	const degraded = read(
		pool({devices: [member('a'), member('b', 'DEGRADED', {checksumErrors: 40}), member('c')]}),
		attached,
	)!
	expect(degraded.pool.members[1].state).toBe('online')
	expect(degraded.drives.find((drive) => drive.id === 'b')).toMatchObject({degraded: true, errors: 40})
})

test('a drive that is gone is known by the name and the size the storage remembers', () => {
	// A SATA drive: model and serial number
	expect(missingDrive('WDC_WD80EFAX-68KNBN0_VAJ1ABCD', 'hdd', 8 * TB - 115_343_360)).toMatchObject({
		model: 'WDC WD80EFAX-68KNBN0',
		serial: 'VAJ1ABCD',
		size: 8 * TB,
		absent: true,
		smart: 'unknown',
	})
	// An NVMe drive carries its namespace on the end
	expect(missingDrive('Samsung_SSD_990_PRO_2TB_S7KGNJ0X123456_1', 'ssd', undefined)).toMatchObject({
		model: 'Samsung SSD 990 PRO 2TB',
		serial: 'S7KGNJ0X123456',
		size: 0,
	})
	// A name without that shape is shown whole, not cut up
	expect(missingDrive('35000c500a1b2c3d4', 'hdd', undefined)).toMatchObject({model: '', serial: '35000c500a1b2c3d4'})
})

test('the size a missing drive counts as is the step umbreld rounded it to', () => {
	const kept = 115_343_360
	const counted = (remembered: number) => missingDrive('Model_Serial', 'hdd', remembered).size
	expect(counted(8 * TB - kept)).toBe(8 * TB)
	expect(counted(1 * TB - kept)).toBe(1 * TB)
	// Below 1TB umbreld rounds to 25GB, so a 960GB drive counts as 950GB and never as 1TB:
	// otherwise another 960GB drive would be turned away as too small
	expect(counted(950 * GB - kept)).toBe(950 * GB)
	expect(counted(250 * GB - kept)).toBe(250 * GB)
	// Below 250GB nothing is rounded
	expect(counted(240 * GB - kept)).toBe(240 * GB - kept)
})

test('a storage whose drives can’t be told apart as SSDs or hard drives isn’t guessed at', () => {
	const gone = pool({raidType: 'storage', topology: 'stripe', devices: [member('a', 'UNAVAIL')]})
	expect(read(gone, [])).toBeNull()
	// One-drive protection is open to both kinds
	expect(read(pool({devices: [member('a', 'UNAVAIL'), member('b', 'UNAVAIL')]}), [])).toBeNull()
	// An Umbrel Pro's storage is SSDs, even when none can be seen
	const pro = toStorageState({raid: gone, devices: [], isPro: true, progress: null, record: null})!
	expect(pro.pool.kind).toBe('ssd')
	expect(pro.pool.members).toEqual([{id: 'a', state: 'missing'}])
	// Only hard drives are mirrored in pairs
	expect(
		read(pool({topology: 'mirror', mirrors: [['a', 'b']], devices: [member('a', 'UNAVAIL')]}), [])!.pool.kind,
	).toBe('hdd')
})

test('space is what umbreld measures, with the acceleration SSDs’ share taken out', () => {
	const accelerated = pool({
		usableSpace: 16 * TB + 500 * GB,
		accelerator: {
			exists: true,
			devices: [member('x'), member('y')],
			specialSize: 500 * GB,
			specialFreeSpace: 450 * GB,
			l2arcSize: 500 * GB,
		},
	})
	const ssd = (id: string) => device(id, {type: 'ssd', roundedSize: 1 * TB} as Partial<StorageDevice>)
	const state = read(accelerated, [...attached, ssd('x'), ssd('y')])!
	expect(state.pool.reported?.usable).toBe(16 * TB)
	expect(state.pool.accelRoom).toBe(500 * GB)
	expect(state.pool.accelUsed).toBeCloseTo(0.1)
	expect(state.pool.accel.map((entry) => entry.id)).toEqual(['x', 'y'])
})

test('a storage that umbreld says has stopped is read as stopped, whatever its drives look like', () => {
	const state = read(pool({status: 'UNAVAIL'}), attached)!
	expect(state.pool.unavailable).toBe(true)
	expect(viewPool(state).status).toBe('offline')
})

test('damaged data is counted whichever number carries it', () => {
	expect(read(pool({dataErrors: 3}), attached)!.pool.dataErrors).toBe(3)
	expect(read(pool({scrub: {state: 'finished', progress: 100, errors: 2}}), attached)!.pool.dataErrors).toBe(2)
	// A check that is still running hasn't found anything it couldn't repair yet
	expect(read(pool({scrub: {state: 'scrubbing', progress: 40, errors: 2}}), attached)!.pool.dataErrors).toBe(0)
})

const rebuilding: RaidProgress = {type: 'replace', state: 'rebuilding', progress: 42}

test('the drives a task involves are only known to the browser that started it', () => {
	// While a working drive is replaced, the storage lists it beside its replacement
	const raid = pool({devices: [member('a'), member('b'), member('new'), member('c')]})
	const devices = [...attached, device('new')]
	// The browser that asked for it knows which is which: the old one is on its way out
	const record = recordOf({type: 'replace', memberId: 'b', newId: 'new'}, 1, true)
	const known = read(raid, devices, {progress: rebuilding, record})!
	expect(known.pool.members).toEqual([
		{id: 'a', state: 'online'},
		{id: 'new', state: 'rebuilding'},
		{id: 'c', state: 'online'},
	])
	expect(known.op).toEqual({kind: 'rebuild', progress: 42, memberId: 'new', oldId: 'b'})
	// A drive the storage had already let go of isn't waited for: it is simply out of the storage
	const failedOld = recordOf({type: 'replace', memberId: 'b', newId: 'new'}, 1, false)
	const replacing = read(raid, devices, {progress: rebuilding, record: failedOld})!
	expect(replacing.pool.members.map((entry) => entry.id)).toEqual(['a', 'new', 'c'])
	expect(replacing.op).toEqual({kind: 'rebuild', progress: 42, memberId: 'new', oldId: undefined})
	expect(viewPool(replacing).leaving).toBeUndefined()
	// Any other browser sees the task and its progress, and claims nothing about the drives
	const unknown = read(raid, devices, {progress: rebuilding})!
	expect(unknown.op).toEqual({kind: 'rebuild', progress: 42, memberId: undefined, oldId: undefined})
	expect(unknown.pool.members.every((entry) => entry.state === 'online')).toBe(true)
})

test('a mirrored pair keeps its replacement beside it while it is rebuilt', () => {
	// umbreld lists a pair that is having a drive replaced with only its other drive
	const raid = pool({
		topology: 'mirror',
		raidzParity: undefined,
		devices: [member('a'), member('new'), member('c'), member('d')],
		mirrors: [['a'], ['c', 'd']],
	})
	const devices = [device('a'), device('new'), device('c'), device('d')]
	const record = recordOf({type: 'replace', memberId: 'b', newId: 'new'}, 1)
	const state = read(raid, devices, {progress: rebuilding, record})!
	expect(state.pool.members.map((entry) => entry.id)).toEqual(['a', 'new', 'c', 'd'])
	expect(viewPool(state).capacity.pairs).toEqual([
		['a', 'new'],
		['c', 'd'],
	])
})

test('a switch to FailSafe shows the level it is heading for once that is known', () => {
	const copying: RaidProgress = {type: 'failsafe-transition', state: 'syncing', progress: 20}
	const single = pool({raidType: 'storage', topology: 'stripe', devices: [member('a')]})
	const devices = [device('a'), device('b')]
	// Before the restart the storage still looks unprotected: only the browser that started the
	// switch knows where it is heading
	const record = recordOf({type: 'failsafe', to: 'raidz1', newIds: ['b']}, 1)
	expect(read(single, devices, {progress: copying, record})!.op).toMatchObject({
		kind: 'failsafe',
		phase: 'copying',
		to: 'raidz1',
		newIds: ['b'],
	})
	expect(read(single, devices, {progress: copying})!.op).toMatchObject({kind: 'failsafe', to: undefined})
	// After it, the storage itself says so
	const finishing: RaidProgress = {type: 'failsafe-transition', state: 'rebuilding', progress: 70}
	expect(read(pool({devices: [member('a'), member('b')]}), devices, {progress: finishing})!.op).toMatchObject({
		phase: 'rebuilding',
		to: 'raidz1',
	})
})

test('a task that has ended is no longer a task', () => {
	for (const state of ['finished', 'complete', 'canceled', 'error']) {
		expect(read(pool(), attached, {progress: {type: 'replace', state, progress: 100}})!.op).toBeNull()
	}
})

test('only drives umbreld can be told to use are offered at setup', () => {
	const devices = [
		device('a'),
		device('boot', {isSystemDrive: true, type: 'ssd'} as Partial<StorageDevice>),
		{...device('nameless'), id: undefined} as StorageDevice,
	]
	// Other hardware shows the drive umbrelOS runs from, marked, and never a drive without a name
	expect(toHardware(devices, false).drives.map((drive) => [drive.id, !!drive.system])).toEqual([
		['a', false],
		['boot', true],
	])
	// Umbrel Pro's storage is its SSD slots
	expect(toHardware(devices, true).drives).toEqual([])
})

test('before login, nothing is claimed that umbreld didn’t answer', () => {
	const devices = [device('a'), device('spare')]
	const members = [
		{name: 'a', isOk: true},
		{name: 'WDC_WD80EFAX_GONE', isOk: false},
	]
	// Both answers arrived: a member that isn't among the drives is missing, and a drive that
	// isn't among the members is a spare
	const known = toStartFailureDrives({members, membersKnown: true, devices, devicesKnown: true, isPro: false})
	expect(known.map((entry) => [entry.drive.id, entry.drive.absent, entry.member])).toEqual([
		['a', undefined, {responding: true}],
		['WDC_WD80EFAX_GONE', true, {responding: false}],
		['spare', undefined, undefined],
	])
	// The drives couldn't be listed: a member isn't called missing on that account
	const unlisted = toStartFailureDrives({members, membersKnown: true, devices: [], devicesKnown: false, isPro: false})
	expect(unlisted.map((entry) => entry.drive.absent)).toEqual([undefined, undefined])
	// The storage's own drives couldn't be listed: no drive is called a spare on that account
	const unasked = toStartFailureDrives({members: [], membersKnown: false, devices, devicesKnown: true, isPro: false})
	expect(unasked.map((entry) => entry.member)).toEqual([{}, {}])
})
