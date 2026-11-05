import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import Thunderbolt, {
	LEGACY_EXTERNAL_GPU_NOTIFICATION_PREFIX,
	discoverThunderboltDevices,
	thunderboltNotification,
} from './thunderbolt.ts'

const DEVICE_ID = 'ba010000-0062-6c1e-0332-0ee0c2424909'
const SECOND_DEVICE_ID = 'ba010000-0062-6c1e-0332-0ee0c2424910'

let devicesPath: string
let remembered: {id: string; name?: string; vendor?: string}[]
let notifications: string[]
let umbreld: Umbreld

async function addDevice({
	id = DEVICE_ID,
	authorized = false,
	name = 'DS-9003',
	vendor = 'TB4',
	entry = '1-2',
	security = 'user',
}: {
	id?: string
	authorized?: boolean
	name?: string
	vendor?: string
	entry?: string
	security?: string | null
} = {}) {
	const path = nodePath.join(devicesPath, entry)
	await fse.ensureDir(path)
	const writes = [
		fse.writeFile(nodePath.join(path, 'unique_id'), `${id}\n`),
		fse.writeFile(nodePath.join(path, 'authorized'), authorized ? '1\n' : '0\n'),
		fse.writeFile(nodePath.join(path, 'device_name'), `${name}\n`),
		fse.writeFile(nodePath.join(path, 'vendor_name'), `${vendor}\n`),
	]
	if (security !== null) {
		const domain = Number.parseInt(entry.split('-')[0]!, 10)
		writes.push(setDomainSecurity(security, domain))
	}
	await Promise.all(writes)
	return path
}

async function setDomainSecurity(security: string, domain = 1) {
	const domainPath = nodePath.join(devicesPath, `domain${domain}`)
	await fse.ensureDir(domainPath)
	await fse.writeFile(nodePath.join(domainPath, 'security'), `${security}\n`)
}

function createEventMonitor() {
	let onEvent: (() => Promise<void>) | undefined
	let finish: (() => void) | undefined
	const start = vi.fn((listener: () => Promise<void>) => {
		onEvent = listener
		const finished = new Promise<void>((resolve) => (finish = resolve))
		return {
			finished,
			stop: async () => finish?.(),
		}
	})

	return {
		start,
		emit: async () => {
			if (!onEvent) throw new Error('Event monitor has not started')
			await onEvent()
		},
	}
}

beforeEach(async () => {
	devicesPath = await fse.mkdtemp(nodePath.join(os.tmpdir(), 'umbreld-thunderbolt-test-'))
	remembered = []
	notifications = []
	const get = vi.fn(async () => remembered)
	const set = vi.fn(async (_key, value) => {
		remembered = value as typeof remembered
		return true
	})
	let writeTail: Promise<void> = Promise.resolve()
	const getWriteLock = vi.fn((operation: (methods: {get: typeof get; set: typeof set}) => Promise<void>) => {
		const result = writeTail.then(() => operation({get, set}))
		writeTail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	})
	umbreld = {
		store: {
			get,
			set,
			getWriteLock,
		},
		notifications: {
			get: vi.fn(async () => [...notifications]),
			add: vi.fn(async (notification: string) => {
				notifications = [notification, ...notifications.filter((existing) => existing !== notification)]
				return true
			}),
			clear: vi.fn(async (notification: string) => {
				notifications = notifications.filter((existing) => existing !== notification)
				return true
			}),
		},
		eventBus: {
			emit: vi.fn(),
		},
		logger: {
			createChildLogger: vi.fn(() => ({log: vi.fn(), error: vi.fn()})),
		},
	} as unknown as Umbreld
})

afterEach(async () => {
	await fse.remove(devicesPath)
})

describe('discoverThunderboltDevices', () => {
	test('returns named Thunderbolt peripherals and structurally excludes named host routers', async () => {
		await addDevice({authorized: true})
		const routerPath = nodePath.join(devicesPath, '1-0')
		await fse.ensureDir(routerPath)
		await Promise.all([
			fse.writeFile(nodePath.join(routerPath, 'unique_id'), '24a03804-6132-143b-ffff-ffffffffffff\n'),
			fse.writeFile(nodePath.join(routerPath, 'authorized'), '1\n'),
			fse.writeFile(nodePath.join(routerPath, 'device_name'), 'Host Router\n'),
			fse.writeFile(nodePath.join(routerPath, 'vendor_name'), 'Firmware Vendor\n'),
		])

		await expect(discoverThunderboltDevices(devicesPath)).resolves.toMatchObject([
			{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4', authorized: true},
		])
	})
})

describe('Thunderbolt', () => {
	const setDeviceAuthorization = async (authorizedPath: string, authorized: boolean) =>
		fse.writeFile(authorizedPath, authorized ? '1\n' : '0\n')

	test('notifies the owner when an unknown Thunderbolt device is connected', async () => {
		await addDevice()
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		await thunderbolt.reconcile()

		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])
		await expect(thunderbolt.getPendingDevices()).resolves.toMatchObject([
			{id: DEVICE_ID, connected: true, authorized: false, remembered: false},
		])
	})

	test('automatically re-authorizes a remembered Thunderbolt device', async () => {
		const devicePath = await addDevice()
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath})

		await thunderbolt.reconcile()

		await expect(fse.readFile(nodePath.join(devicePath, 'authorized'), 'utf8')).resolves.toBe('1')
		expect(notifications).toStrictEqual([])
	})

	test('forgets a remembered device when automatic re-authorization fails', async () => {
		await addDevice()
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		const setDeviceAuthorization = vi.fn(async () => undefined)
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		await thunderbolt.reconcile()

		expect(setDeviceAuthorization).toHaveBeenCalledTimes(1)
		expect(remembered).toStrictEqual([])
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])

		// Subsequent udev events must not retry the rejected remembered approval.
		await thunderbolt.reconcile()
		expect(setDeviceAuthorization).toHaveBeenCalledTimes(1)
	})

	test('requires fresh approval for remembered devices on secure-mode domains', async () => {
		const devicePath = await addDevice()
		await setDomainSecurity('secure')
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath})

		await thunderbolt.reconcile()

		await expect(fse.readFile(nodePath.join(devicePath, 'authorized'), 'utf8')).resolves.toBe('0\n')
		expect(remembered).toStrictEqual([])
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])

		await expect(thunderbolt.authorize(DEVICE_ID)).resolves.toMatchObject({
			id: DEVICE_ID,
			authorized: true,
			remembered: false,
		})
		await expect(fse.readFile(nodePath.join(devicePath, 'authorized'), 'utf8')).resolves.toBe('1')
		expect(remembered).toStrictEqual([])

		// A reconnect (and equivalently a reboot) presents the device as
		// unauthorized again. With no persisted UUID approval it must prompt.
		await fse.writeFile(nodePath.join(devicePath, 'authorized'), '0\n')
		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])
	})

	test.each([
		['an unreadable', null],
		['an unrecognized', 'future-security-mode'],
	] as const)('fails closed when the domain has %s security mode', async (_description, security) => {
		const devicePath = await addDevice({security})
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		await thunderbolt.reconcile()

		await expect(fse.readFile(nodePath.join(devicePath, 'authorized'), 'utf8')).resolves.toBe('0\n')
		expect(remembered).toStrictEqual([])
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])

		await expect(thunderbolt.authorize(DEVICE_ID)).resolves.toMatchObject({
			id: DEVICE_ID,
			authorized: true,
			remembered: false,
		})
		expect(remembered).toStrictEqual([])
	})

	test('reconciles immediately when udev reports a Thunderbolt event', async () => {
		const eventMonitor = createEventMonitor()
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization,
			startEventMonitor: eventMonitor.start,
		})

		try {
			await thunderbolt.start()
			expect(notifications).toStrictEqual([])

			await addDevice()
			await eventMonitor.emit()

			expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])
		} finally {
			await thunderbolt.stop()
		}
	})

	test('waits after each fallback scan and never overlaps reconciliations', async () => {
		await addDevice()
		const eventMonitor = createEventMonitor()

		let calls = 0
		let activeCalls = 0
		let maxActiveCalls = 0
		let finishSecondCall!: () => void
		vi.mocked(umbreld.notifications.get).mockImplementation(async () => {
			calls += 1
			activeCalls += 1
			maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
			if (calls === 2) await new Promise<void>((resolve) => (finishSecondCall = resolve))
			activeCalls -= 1
			return [...notifications]
		})
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			scanIntervalMs: 5,
			startEventMonitor: eventMonitor.start,
		})

		try {
			await thunderbolt.start()
			await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(1))

			await vi.waitFor(() => expect(calls).toBe(2))
			await new Promise((resolve) => globalThis.setTimeout(resolve, 20))
			expect(calls).toBe(2)
			expect(maxActiveCalls).toBe(1)

			finishSecondCall()
			await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3))
			expect(maxActiveCalls).toBe(1)
		} finally {
			finishSecondCall?.()
			await thunderbolt.stop()
		}
	})

	test('persists an approval only after authorizing the connected device', async () => {
		const devicePath = await addDevice()
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization,
			authorizationStabilityMs: 0,
		})
		notifications = [thunderboltNotification(DEVICE_ID)]

		await expect(thunderbolt.authorize(DEVICE_ID)).resolves.toMatchObject({
			id: DEVICE_ID,
			connected: true,
			authorized: true,
			remembered: true,
		})

		await expect(fse.readFile(nodePath.join(devicePath, 'authorized'), 'utf8')).resolves.toBe('1\n')
		expect(remembered).toStrictEqual([{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}])
		expect(notifications).toStrictEqual([])
	})

	test('waits for a flapping device to reconnect before authorizing it', async () => {
		notifications = [thunderboltNotification(DEVICE_ID)]
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization,
			authorizationReconnectTimeoutMs: 1_000,
			authorizationRetryIntervalMs: 1,
			authorizationStabilityMs: 0,
		})

		const authorization = thunderbolt.authorize(DEVICE_ID)
		await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
		const devicePath = await addDevice()

		await expect(authorization).resolves.toMatchObject({
			id: DEVICE_ID,
			connected: true,
			authorized: true,
			remembered: true,
		})
		await expect(fse.readFile(nodePath.join(devicePath, 'authorized'), 'utf8')).resolves.toBe('1\n')
		expect(remembered).toStrictEqual([{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}])
		expect(notifications).toStrictEqual([])
	})

	test('retries when a device disconnects during authorization', async () => {
		await addDevice()
		let attempts = 0
		const flappingAuthorization = vi.fn(async (authorizedPath: string, authorized: boolean) => {
			attempts += 1
			if (attempts === 1) {
				await fse.remove(nodePath.dirname(authorizedPath))
				throw new Error('device disappeared')
			}
			await fse.writeFile(authorizedPath, authorized ? '1\n' : '0\n')
		})
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization: flappingAuthorization,
			authorizationReconnectTimeoutMs: 1_000,
			authorizationRetryIntervalMs: 1,
			authorizationStabilityMs: 0,
		})

		const authorization = thunderbolt.authorize(DEVICE_ID)
		await vi.waitFor(() => expect(flappingAuthorization).toHaveBeenCalledTimes(1))
		await addDevice()

		await expect(authorization).resolves.toMatchObject({id: DEVICE_ID, authorized: true, remembered: true})
		expect(flappingAuthorization).toHaveBeenCalledTimes(2)
	})

	test('discards session-only remembered trust just once while authorization retries', async () => {
		await addDevice({security: 'secure'})
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		const rejectedAuthorization = vi.fn(async () => undefined)
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization: rejectedAuthorization,
			authorizationReconnectTimeoutMs: 20,
			authorizationRetryIntervalMs: 1,
			authorizationStabilityMs: 0,
		})

		await expect(thunderbolt.authorize(DEVICE_ID)).rejects.toThrow('remained unauthorized')

		expect(rejectedAuthorization.mock.calls.length).toBeGreaterThan(1)
		expect(umbreld.store.getWriteLock).toHaveBeenCalledTimes(1)
		expect(remembered).toStrictEqual([])
	})

	test('emits a devices-change event exactly once per observable device change', async () => {
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		// The change check runs on the state transition queue after the transition
		// that caused it, so each assertion follows one further transition, which
		// guarantees the previous check has completed while its own is still queued.
		await thunderbolt.reconcile()
		await thunderbolt.reconcile()
		// The first check announces the initial state, an unchanged rescan is silent
		expect(umbreld.eventBus.emit).toHaveBeenCalledTimes(1)
		expect(umbreld.eventBus.emit).toHaveBeenCalledWith('hardware:thunderbolt:devices-change')

		// Connecting a new device
		await addDevice()
		await thunderbolt.reconcile()
		await thunderbolt.reconcile()
		expect(umbreld.eventBus.emit).toHaveBeenCalledTimes(2)

		// Authorizing it
		await thunderbolt.authorize(DEVICE_ID)
		await thunderbolt.reconcile()
		expect(umbreld.eventBus.emit).toHaveBeenCalledTimes(3)

		// Revoking it
		await thunderbolt.revoke(DEVICE_ID)
		await thunderbolt.reconcile()
		expect(umbreld.eventBus.emit).toHaveBeenCalledTimes(4)
	})

	test('serializes concurrent approvals without losing remembered devices', async () => {
		await Promise.all([
			addDevice({entry: '1-1'}),
			addDevice({id: SECOND_DEVICE_ID, name: 'Second Device', entry: '1-2'}),
		])
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		await Promise.all([thunderbolt.authorize(DEVICE_ID), thunderbolt.authorize(SECOND_DEVICE_ID)])

		expect(remembered).toStrictEqual([
			{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'},
			{id: SECOND_DEVICE_ID, name: 'Second Device', vendor: 'TB4'},
		])
		expect(umbreld.store.getWriteLock).toHaveBeenCalledTimes(2)
	})

	test('keeps approval state when unplugged and clears a stale notification after the disconnect grace period', async () => {
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		notifications = [thunderboltNotification(DEVICE_ID)]
		let now = 1_000
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization,
			notificationDisconnectGraceMs: 30_000,
			now: () => now,
		})

		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])

		now += 29_999
		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])

		now += 1
		await thunderbolt.reconcile()

		expect(remembered).toHaveLength(1)
		expect(notifications).toStrictEqual([])
		await expect(thunderbolt.getDevices()).resolves.toStrictEqual([
			{
				id: DEVICE_ID,
				name: 'DS-9003',
				vendor: 'TB4',
				connected: false,
				authorized: false,
				remembered: true,
			},
		])
	})

	test('keeps the approval prompt stable across brief Thunderbolt disconnects', async () => {
		let now = 1_000
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization,
			notificationDisconnectGraceMs: 30_000,
			now: () => now,
		})
		const devicePath = await addDevice()

		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])

		await fse.remove(devicePath)
		now += 10_000
		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])

		await addDevice()
		now += 10_000
		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])

		await fse.remove(devicePath)
		now += 10_000
		await thunderbolt.reconcile()
		now += 30_000
		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([])
	})

	test('does not remember a device when kernel authorization fails', async () => {
		await addDevice()
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization: async () => undefined,
			authorizationReconnectTimeoutMs: 0,
			authorizationStabilityMs: 0,
		})

		await expect(thunderbolt.authorize(DEVICE_ID)).rejects.toThrow('remained unauthorized')
		expect(remembered).toStrictEqual([])
	})

	test('revokes remembered trust and immediately deauthorizes a connected device', async () => {
		const devicePath = await addDevice({authorized: true})
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		await expect(thunderbolt.revoke(DEVICE_ID)).resolves.toMatchObject({
			id: DEVICE_ID,
			connected: true,
			authorized: false,
			remembered: false,
		})

		await expect(fse.readFile(nodePath.join(devicePath, 'authorized'), 'utf8')).resolves.toBe('0\n')
		expect(remembered).toStrictEqual([])
	})

	test('serializes reconciliation behind an in-flight revocation', async () => {
		const devicePath = await addDevice({authorized: true})
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		let releaseDeauthorization!: () => void
		let deauthorizationStarted!: () => void
		const started = new Promise<void>((resolve) => (deauthorizationStarted = resolve))
		const release = new Promise<void>((resolve) => (releaseDeauthorization = resolve))
		const writes: boolean[] = []
		const blockingAuthorization = async (authorizedPath: string, authorized: boolean) => {
			writes.push(authorized)
			await fse.writeFile(authorizedPath, authorized ? '1\n' : '0\n')
			if (!authorized) {
				deauthorizationStarted()
				await release
			}
		}
		const thunderbolt = new Thunderbolt(umbreld, {
			devicesPath,
			setDeviceAuthorization: blockingAuthorization,
		})

		const revoke = thunderbolt.revoke(DEVICE_ID)
		await started
		const reconcile = thunderbolt.reconcile()
		await new Promise((resolve) => globalThis.setTimeout(resolve, 20))
		expect(umbreld.notifications.get).not.toHaveBeenCalled()

		releaseDeauthorization()
		await Promise.all([revoke, reconcile])

		expect(writes).toStrictEqual([false])
		await expect(fse.readFile(nodePath.join(devicePath, 'authorized'), 'utf8')).resolves.toBe('0\n')
		expect(remembered).toStrictEqual([])
	})

	test('does not immediately prompt again after revocation, but prompts after reconnect', async () => {
		const devicePath = await addDevice({authorized: true})
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		await thunderbolt.revoke(DEVICE_ID)
		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([])

		await fse.remove(devicePath)
		await thunderbolt.reconcile()
		await addDevice()
		await thunderbolt.reconcile()
		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])
	})

	test('forgets a disconnected device without requiring it to be attached', async () => {
		remembered = [{id: DEVICE_ID, name: 'DS-9003', vendor: 'TB4'}]
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		await expect(thunderbolt.revoke(DEVICE_ID)).resolves.toMatchObject({
			id: DEVICE_ID,
			connected: false,
			authorized: false,
			remembered: false,
		})
		expect(remembered).toStrictEqual([])
	})

	test('replaces legacy eGPU notifications with generalized Thunderbolt notifications', async () => {
		await addDevice()
		notifications = [`${LEGACY_EXTERNAL_GPU_NOTIFICATION_PREFIX}${encodeURIComponent(DEVICE_ID)}`]
		const thunderbolt = new Thunderbolt(umbreld, {devicesPath, setDeviceAuthorization})

		await thunderbolt.reconcile()

		expect(notifications).toStrictEqual([thunderboltNotification(DEVICE_ID)])
	})
})
