// What Storage Manager says first, what an open sheet does when the storage changes under it,
// and what everything outside Storage Manager says about the storage.

import type {TFunction} from 'i18next'
import {expect, test} from 'vitest'

import {getHeadline} from '../headline'
import type {RaidStatus, StorageDevice} from '../hooks/use-storage'
import {Drive, TB} from '../model'
import {MemberState, StorageState, viewPool} from '../state'
import {getStatus, sheetForSwap, sheetStands} from './status'

// Keys stand in for sentences: what is said is decided here, how it is worded is en.json's
const t = ((key: string) => key) as unknown as TFunction

function storage(
	members: Record<string, MemberState>,
	loose: string[] = [],
	extra: Partial<StorageState['pool']> = {},
) {
	const drive = (id: string, state?: MemberState): Drive => ({
		id,
		kind: 'hdd',
		size: 8 * TB,
		model: 'Model',
		serial: id,
		smart: state === 'failed' ? 'unhealthy' : 'healthy',
		absent: state === 'missing' || undefined,
	})
	const state: StorageState = {
		device: 'other',
		drives: [
			...Object.entries(members).map(([id, memberState]) => drive(id, memberState)),
			...loose.map((id) => drive(id)),
		],
		pool: {
			kind: 'hdd',
			layout: 'raidz1',
			members: Object.entries(members).map(([id, memberState]) => ({id, state: memberState})),
			accel: [],
			used: 0,
			dataErrors: 0,
			partialPairs: null,
			...extra,
		},
		op: null,
		failsafeError: null,
	}
	return state
}

const stands = (state: StorageState, sheet: Parameters<typeof sheetStands>[2]) =>
	sheetStands(state, viewPool(state), sheet)

test('a replace sheet closes when its drive comes back, and never moves on to another', () => {
	// Two-drive protection, so the storage keeps running with both drives down
	const before = storage({a: 'online', b: 'failed', c: 'failed', d: 'online'}, ['spare'], {layout: 'raidz2'})
	const sheet = sheetForSwap(before, 'b')
	expect(sheet).toEqual({type: 'replace', memberId: 'b', newId: 'spare', broken: true})
	expect(stands(before, sheet)).toBe(true)
	// The drive it was opened for is working again: what the sheet says is no longer true, and
	// the other failed drive is not what anyone agreed to replace
	const after = storage({a: 'online', b: 'online', c: 'failed', d: 'online'}, ['spare'], {layout: 'raidz2'})
	expect(stands(after, sheet)).toBe(false)
})

test('a replace sheet closes when the new drive is taken out', () => {
	const sheet = sheetForSwap(storage({a: 'online', b: 'failed', c: 'online'}, ['spare']), 'b')
	expect(stands(storage({a: 'online', b: 'failed', c: 'online'}), sheet)).toBe(false)
})

test('a steps sheet closes once a new drive is in, so the confirmation is read fresh', () => {
	const before = storage({a: 'online', b: 'missing', c: 'online'})
	const sheet = sheetForSwap(before, 'b')
	expect(sheet).toMatchObject({type: 'steps', variant: 'insert'})
	expect(stands(before, sheet)).toBe(true)
	expect(stands(storage({a: 'online', b: 'missing', c: 'online'}, ['spare']), sheet)).toBe(false)
})

test('a storage that has stopped closes every sheet that would change it', () => {
	const running = storage({a: 'online', b: 'failed', c: 'online'}, ['spare'])
	const stopped = storage({a: 'online', b: 'failed', c: 'online'}, ['spare'], {unavailable: true})
	expect(stands(stopped, sheetForSwap(running, 'b'))).toBe(false)
	expect(stands(stopped, {type: 'failsafe'})).toBe(false)
	expect(stands(stopped, {type: 'new', kind: 'hdd'})).toBe(false)
	// What explains it stays open
	expect(stands(stopped, {type: 'offline'})).toBe(true)
	expect(stands(stopped, {type: 'drive', id: 'b'})).toBe(true)
	// And the sheet for a stopped storage closes when it is running again
	expect(stands(running, {type: 'offline'})).toBe(false)
})

test('a drive’s own sheet closes when the drive is gone from the machine and the storage', () => {
	const state = storage({a: 'online', b: 'online', c: 'online'}, ['spare'])
	expect(stands(state, {type: 'drive', id: 'spare'})).toBe(true)
	expect(stands(storage({a: 'online', b: 'online', c: 'online'}), {type: 'drive', id: 'spare'})).toBe(false)
})

test('Storage Manager leads with what matters most to someone’s data', () => {
	const title = (state: StorageState) => getStatus(state, viewPool(state), t, 'en').title
	expect(title(storage({a: 'online', b: 'online', c: 'online'}))).toBe('storage-mgr.status.protected.title')
	expect(title(storage({a: 'online', b: 'failed', c: 'online'}))).toBe('storage-mgr.status.broken.failed.hdd')
	expect(title(storage({a: 'online', b: 'missing', c: 'online'}))).toBe('storage-mgr.status.broken.missing.hdd')
	// Damaged data is said even when every drive is fine
	expect(title(storage({a: 'online', b: 'online', c: 'online'}, [], {dataErrors: 2}))).toBe(
		'storage-mgr.status.damage.title',
	)
	// A storage that has stopped comes before everything
	expect(title(storage({a: 'online', b: 'failed', c: 'online'}, [], {unavailable: true, dataErrors: 2}))).toBe(
		'storage-mgr.status.offline.title',
	)
})

test('FailSafe with SSD Acceleration left on one SSD never reads as protected', () => {
	// A switch that stopped before the SSD got its mirror: the SSD holds the index to every file
	const state = storage({a: 'online', b: 'online', c: 'online'})
	state.drives.push({id: 'ssd', kind: 'ssd', size: 1 * TB, model: 'Model', serial: 'ssd', smart: 'healthy'})
	state.pool.accel = [{id: 'ssd', state: 'online'}]
	const view = viewPool(state)
	expect(view.status).toBe('at-risk')
	expect(getStatus(state, view, t, 'en')).toMatchObject({
		tone: 'critical',
		title: 'storage-mgr.status.partly.title',
		body: 'storage-mgr.status.partly.accel.protected',
	})
	// With its mirror, it is
	state.drives.push({id: 'ssd2', kind: 'ssd', size: 1 * TB, model: 'Model', serial: 'ssd2', smart: 'healthy'})
	state.pool.accel.push({id: 'ssd2', state: 'online'})
	expect(viewPool(state).status).toBe('protected')
})

test('storage made of SSDs is told about SSDs, and hard drives about drives', () => {
	// Every sentence is asked for in the storage's words: one with an SSD form uses it
	const contexts = (kind: 'ssd' | 'hdd') => {
		const asked: (string | undefined)[] = []
		const spy = ((key: string, options?: {context?: string}) => {
			asked.push(options?.context)
			return key
		}) as unknown as TFunction
		const state = storage({a: 'online', b: 'failed', c: 'online'})
		state.pool.kind = kind
		state.drives = state.drives.map((drive) => ({...drive, kind}))
		getStatus(state, viewPool(state), spy, 'en')
		return asked
	}
	expect(contexts('ssd').length).toBeGreaterThan(0)
	expect(contexts('ssd').every((context) => context === 'ssd')).toBe(true)
	expect(contexts('hdd').every((context) => context === undefined)).toBe(true)
})

// What everything outside Storage Manager says
const device = (id: string, extra: object = {}): StorageDevice =>
	({
		id,
		type: 'hdd',
		name: 'Model',
		serial: id,
		size: 8 * TB,
		roundedSize: 8 * TB,
		smartStatus: 'healthy',
		...extra,
	}) as StorageDevice
const member = (id: string, status = 'ONLINE') => ({id, status, readErrors: 0, writeErrors: 0, checksumErrors: 0})
const raid = (overrides: object = {}): RaidStatus =>
	({
		name: 'umbrelos',
		exists: true,
		raidType: 'failsafe',
		topology: 'raidz',
		raidzParity: 1,
		status: 'ONLINE',
		devices: [member('a'), member('b'), member('c')],
		dataErrors: 0,
		accelerator: {exists: false, devices: []},
		...overrides,
	}) as unknown as RaidStatus
const headline = (status: RaidStatus, devices: StorageDevice[], extra: object = {}) =>
	getHeadline({raid: status, devices, isPro: false, t, locale: 'en', ...extra})
const three = [device('a'), device('b'), device('c')]

test('the headline is Storage Manager’s own first sentence', () => {
	expect(headline(raid(), three)).toMatchObject({title: 'storage-mgr.status.protected.title', alarming: false})
	const degraded = raid({status: 'DEGRADED', devices: [member('a'), member('b', 'FAULTED'), member('c')]})
	expect(headline(degraded, [three[0], three[2]])).toMatchObject({
		tone: 'critical',
		title: 'storage-mgr.status.broken.missing.hdd',
		alarming: true,
	})
	// A drive that still works but fails its health check is raised too
	const failing = [three[0], device('b', {smartStatus: 'unhealthy'}), three[2]]
	expect(headline(raid(), failing)).toMatchObject({title: 'storage-mgr.status.trouble.failing.hdd', alarming: true})
})

test('a task that is running is read from umbreld’s status when there are no events to go by', () => {
	const rebuilding = raid({replace: {state: 'rebuilding', progress: 42}})
	expect(headline(rebuilding, three)).toMatchObject({
		tone: 'busy',
		title: 'storage-mgr.status.rebuild.title',
		progress: 42,
		alarming: false,
	})
})

test('running low on space is marked, since umbrelOS already raises that on its own', () => {
	const nearlyFull = raid({usableSpace: 16 * TB, usedSpace: 15.5 * TB, totalSpace: 24 * TB})
	expect(headline(nearlyFull, three)).toMatchObject({title: 'storage-mgr.status.full.title', space: true})
})

test('a machine that keeps everything on one drive is worded by that drive', () => {
	const none = {name: '', exists: false} as RaidStatus
	const boot = (extra: object = {}) => [device('boot', {type: 'ssd', isSystemDrive: true, ...extra})]
	expect(headline(none, boot(), {host: 'home'})).toMatchObject({title: 'storage-ui.health.healthy', alarming: false})
	expect(headline(none, boot({smartStatus: 'unhealthy'}), {host: 'home'})).toMatchObject({
		title: 'storage-single.trouble.failing.ssd',
		alarming: true,
	})
})

test('a storage that is set up but can’t be read is raised, not passed over', () => {
	// Set up, and not running
	expect(headline({name: 'umbrelos', exists: false} as RaidStatus, three)).toMatchObject({
		title: 'storage-single.unreadable.unidentified.title',
		alarming: true,
	})
	// Running, with no drive to say what it is made of
	const unseen = raid({raidType: 'storage', topology: 'stripe', devices: [member('a', 'UNAVAIL')]})
	expect(headline(unseen, [])).toMatchObject({title: 'storage-single.unreadable.unidentified.title'})
	// Nothing is said before umbreld has answered
	expect(headline(raid(), three, {raid: undefined})).toBeNull()
})
