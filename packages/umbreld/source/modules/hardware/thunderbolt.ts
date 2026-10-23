import nodePath from 'node:path'
import readline from 'node:readline'
import {setTimeout} from 'node:timers/promises'

import fse from 'fs-extra'
import {execa} from 'execa'

import type Umbreld from '../../index.ts'

export const THUNDERBOLT_NOTIFICATION_PREFIX = 'thunderbolt-authorization-required:'
export const LEGACY_EXTERNAL_GPU_NOTIFICATION_PREFIX = 'egpu-authorization-required:'

const THUNDERBOLT_DEVICES_PATH = '/sys/bus/thunderbolt/devices'
const SCAN_INTERVAL_MS = 30_000
const UDEV_MONITOR_RESTART_INTERVAL_MS = 5_000
const NOTIFICATION_DISCONNECT_GRACE_MS = 30_000
const AUTHORIZATION_RECONNECT_TIMEOUT_MS = 15_000
const AUTHORIZATION_RETRY_INTERVAL_MS = 100
const AUTHORIZATION_STABILITY_MS = 500
const UUID_ONLY_SECURITY_MODES = new Set(['none', 'user', 'dponly', 'usbonly', 'nopcie'])

export type ThunderboltDevice = {
	id: string
	name?: string
	vendor?: string
	connected: boolean
	authorized: boolean
	remembered: boolean
}

type DiscoveredThunderboltDevice = Omit<ThunderboltDevice, 'connected' | 'remembered'> & {
	path: string
	security?: string
}

type RememberedThunderboltDevice = Pick<ThunderboltDevice, 'id' | 'name' | 'vendor'>

type ThunderboltEventMonitor = {
	finished: Promise<void>
	stop: () => Promise<void>
}

type ThunderboltOptions = {
	devicesPath?: string
	scanIntervalMs?: number
	setDeviceAuthorization?: (authorizedPath: string, authorized: boolean) => Promise<void>
	startEventMonitor?: (onEvent: () => Promise<void>) => ThunderboltEventMonitor
	notificationDisconnectGraceMs?: number
	authorizationReconnectTimeoutMs?: number
	authorizationRetryIntervalMs?: number
	authorizationStabilityMs?: number
	now?: () => number
}

const readOptional = async (path: string) => {
	try {
		return (await fse.readFile(path, 'utf8')).trim() || undefined
	} catch {
		return undefined
	}
}

export const thunderboltNotification = (id: string) => `${THUNDERBOLT_NOTIFICATION_PREFIX}${encodeURIComponent(id)}`

const legacyExternalGpuNotification = (id: string) =>
	`${LEGACY_EXTERNAL_GPU_NOTIFICATION_PREFIX}${encodeURIComponent(id)}`

// Thunderbolt sysfs device names use <domain>-<route>. Route zero is the host
// router built into the computer, while attached devices use non-zero routes
// such as 1-1 or 1-1.1. Identify host routers from topology rather than labels:
// firmware is allowed to provide a device/vendor name for a host router.
const isHostRouter = (entry: string) => /^\d+-0$/.test(entry)

const domainSecurityPath = (devicesPath: string, entry: string) => {
	const domain = /^(\d+)-/.exec(entry)?.[1]
	return domain ? nodePath.join(devicesPath, `domain${domain}`, 'security') : undefined
}

// Only persist UUID-based approval when the kernel reports a security mode we
// explicitly understand as not requiring secure-connect keys. Missing reads,
// malformed values and future modes fail closed to session-only approval.
const canPersistAuthorization = (security: string | undefined) =>
	security !== undefined && UUID_ONLY_SECURITY_MODES.has(security)

export async function discoverThunderboltDevices(devicesPath = THUNDERBOLT_DEVICES_PATH) {
	const entries = await fse.readdir(devicesPath).catch(() => [] as string[])
	const devices = await Promise.all(
		entries.map(async (entry): Promise<DiscoveredThunderboltDevice | undefined> => {
			if (isHostRouter(entry)) return undefined
			const path = nodePath.join(devicesPath, entry)
			const securityPath = domainSecurityPath(devicesPath, entry)
			const [id, authorized, name, vendor, security] = await Promise.all([
				readOptional(nodePath.join(path, 'unique_id')),
				readOptional(nodePath.join(path, 'authorized')),
				readOptional(nodePath.join(path, 'device_name')),
				readOptional(nodePath.join(path, 'vendor_name')),
				securityPath ? readOptional(securityPath) : undefined,
			])

			if (!id || authorized === undefined || (!name && !vendor)) return undefined
			return {id, name, vendor, authorized: authorized !== '0', path, security}
		}),
	)

	return devices.filter((device): device is DiscoveredThunderboltDevice => device !== undefined)
}

const setDeviceAuthorization = async (authorizedPath: string, authorized: boolean) => {
	await fse.writeFile(authorizedPath, authorized ? '1' : '0')
}

const startEventMonitor = (onEvent: () => Promise<void>): ThunderboltEventMonitor => {
	const process = execa('udevadm', ['monitor', '--udev', '--property', '--subsystem-match=thunderbolt'], {
		buffer: false,
		reject: false,
		stderr: 'ignore',
	})
	if (!process.stdout) {
		process.kill()
		throw new Error('udevadm monitor did not provide stdout')
	}

	const lines = readline.createInterface({input: process.stdout, crlfDelay: Infinity})
	lines.on('line', (line) => {
		// A udev event is emitted as a property block containing exactly one
		// ACTION line. Reconcile from sysfs after udev has processed the event.
		if (line.startsWith('ACTION=')) void onEvent()
	})

	const finished = process.then(() => undefined).finally(() => lines.close())
	return {
		finished,
		async stop() {
			lines.close()
			process.kill()
			await finished
		},
	}
}

export default class Thunderbolt {
	#umbreld: Umbreld
	#devicesPath: string
	#scanIntervalMs: number
	#setDeviceAuthorization: (authorizedPath: string, authorized: boolean) => Promise<void>
	#startEventMonitor: (onEvent: () => Promise<void>) => ThunderboltEventMonitor
	#notificationDisconnectGraceMs: number
	#authorizationReconnectTimeoutMs: number
	#authorizationRetryIntervalMs: number
	#authorizationStabilityMs: number
	#now: () => number
	#revokedUntilDisconnected = new Set<string>()
	#notificationDisconnectedAt = new Map<string, number>()
	#monitorAbortController?: AbortController
	#eventMonitor?: ThunderboltEventMonitor
	#eventMonitorLoopPromise?: Promise<void>
	#scanLoopPromise?: Promise<void>
	#reconcilePromise?: Promise<void>
	#reconcileRequested = false
	#lastDevicesSignature?: string
	#stateTransitionTail: Promise<void> = Promise.resolve()
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld, options: ThunderboltOptions = {}) {
		this.#umbreld = umbreld
		this.#devicesPath = options.devicesPath ?? THUNDERBOLT_DEVICES_PATH
		this.#scanIntervalMs = options.scanIntervalMs ?? SCAN_INTERVAL_MS
		this.#setDeviceAuthorization = options.setDeviceAuthorization ?? setDeviceAuthorization
		this.#startEventMonitor = options.startEventMonitor ?? startEventMonitor
		this.#notificationDisconnectGraceMs = options.notificationDisconnectGraceMs ?? NOTIFICATION_DISCONNECT_GRACE_MS
		this.#authorizationReconnectTimeoutMs =
			options.authorizationReconnectTimeoutMs ?? AUTHORIZATION_RECONNECT_TIMEOUT_MS
		this.#authorizationRetryIntervalMs = options.authorizationRetryIntervalMs ?? AUTHORIZATION_RETRY_INTERVAL_MS
		this.#authorizationStabilityMs = options.authorizationStabilityMs ?? AUTHORIZATION_STABILITY_MS
		this.#now = options.now ?? Date.now
		this.logger = umbreld.logger.createChildLogger('thunderbolt')
	}

	async start() {
		if (this.#monitorAbortController) return
		this.logger.log('Starting Thunderbolt authorization monitor')
		const abortController = new AbortController()
		this.#monitorAbortController = abortController
		this.#eventMonitorLoopPromise = this.#eventMonitorLoop(abortController.signal)
		this.reconcile().catch((error) => this.logger.error('Failed to scan for Thunderbolt devices', error))
		this.#scanLoopPromise = this.#scanLoop(abortController.signal)
	}

	async stop() {
		const abortController = this.#monitorAbortController
		if (!abortController) return

		abortController.abort()
		await this.#eventMonitor?.stop().catch((error) => this.logger.error('Failed to stop udev monitor', error))
		await Promise.all([this.#eventMonitorLoopPromise, this.#scanLoopPromise, this.#reconcilePromise])
		if (this.#monitorAbortController === abortController) {
			this.#monitorAbortController = undefined
			this.#eventMonitor = undefined
			this.#eventMonitorLoopPromise = undefined
			this.#scanLoopPromise = undefined
		}
	}

	async #eventMonitorLoop(signal: AbortSignal) {
		while (!signal.aborted) {
			let monitor: ThunderboltEventMonitor | undefined
			try {
				monitor = this.#startEventMonitor(() =>
					this.reconcile().catch((error) => this.logger.error('Failed to reconcile Thunderbolt udev event', error)),
				)
				this.#eventMonitor = monitor
				await monitor.finished
				if (!signal.aborted) this.logger.error('Thunderbolt udev monitor exited; restarting')
			} catch (error) {
				if (!signal.aborted) this.logger.error('Thunderbolt udev monitor failed; restarting', error)
			} finally {
				if (this.#eventMonitor === monitor) this.#eventMonitor = undefined
			}

			if (signal.aborted) return
			try {
				await setTimeout(UDEV_MONITOR_RESTART_INTERVAL_MS, undefined, {signal, ref: false})
			} catch (error) {
				if (signal.aborted) return
				throw error
			}
		}
	}

	async #scanLoop(signal: AbortSignal) {
		while (!signal.aborted) {
			try {
				// The initial scan runs in start(). Wait only after a completed scan so
				// slow sysfs operations can never overlap the next reconciliation.
				await setTimeout(this.#scanIntervalMs, undefined, {signal, ref: false})
			} catch (error) {
				if (signal.aborted) return
				throw error
			}
			await this.reconcile().catch((error) => this.logger.error('Failed to scan for Thunderbolt devices', error))
		}
	}

	async getDevices(): Promise<ThunderboltDevice[]> {
		const [connected, remembered] = await Promise.all([
			discoverThunderboltDevices(this.#devicesPath),
			this.#getRemembered(),
		])
		const rememberedById = new Map(remembered.map((device) => [device.id, device]))
		const connectedIds = new Set(connected.map(({id}) => id))

		return [
			...connected.map(({path: _path, security, ...device}) => ({
				...device,
				connected: true,
				// Secure, unreadable and unrecognized modes are deliberately
				// session-only until Umbrel supports key-based challenge flows.
				remembered: canPersistAuthorization(security) && rememberedById.has(device.id),
			})),
			...remembered
				.filter(({id}) => !connectedIds.has(id))
				.map((device) => ({...device, connected: false, authorized: false, remembered: true})),
		]
	}

	async getPendingDevices(): Promise<ThunderboltDevice[]> {
		return (await this.getDevices()).filter((device) => device.connected && !device.authorized)
	}

	async authorize(id: string) {
		return this.#runStateTransition(() => this.#authorize(id))
	}

	async #authorize(id: string) {
		const device = await this.#authorizeWhenConnected(id)
		const remember = canPersistAuthorization(device.security)
		if (remember) await this.#remember(device)
		this.#revokedUntilDisconnected.delete(device.id)
		await this.#clearDeviceNotifications(device.id)
		const {path: _path, security: _security, ...result} = device
		return {...result, connected: true, authorized: true, remembered: remember}
	}

	async #authorizeWhenConnected(id: string) {
		const deadline = Date.now() + this.#authorizationReconnectTimeoutMs
		let lastError: unknown
		let discardedNonPersistentApproval = false

		do {
			const device = (await discoverThunderboltDevices(this.#devicesPath)).find((candidate) => candidate.id === id)
			if (device) {
				try {
					// A UUID identifies a device but does not authenticate it. Unless the
					// kernel reports a known UUID-compatible mode, remove any stored
					// approval before granting access for this connection. The owner will
					// be prompted again after reboot or reconnect.
					if (!canPersistAuthorization(device.security) && !discardedNonPersistentApproval) {
						await this.#forget(device.id)
						discardedNonPersistentApproval = true
					}
					await this.#setSystemDeviceAuthorization(device, true)
					if (this.#authorizationStabilityMs > 0) await setTimeout(this.#authorizationStabilityMs)

					// A flapping link may disappear while the kernel is activating its PCIe
					// tunnel. Treat that as a failed attempt instead of remembering a device
					// whose authorization never became usable.
					const stableDevice = (await discoverThunderboltDevices(this.#devicesPath)).find(
						(candidate) => candidate.id === id && candidate.authorized,
					)
					if (!stableDevice) throw new Error('Thunderbolt device disconnected before authorization stabilized')
					return stableDevice
				} catch (error) {
					lastError = error
				}
			}

			const remainingMs = deadline - Date.now()
			if (remainingMs <= 0) break
			await setTimeout(Math.min(this.#authorizationRetryIntervalMs, remainingMs))
		} while (true)

		if (lastError instanceof Error) {
			throw new Error(`Thunderbolt authorization did not stabilize: ${lastError.message}`)
		}
		throw new Error('Thunderbolt device did not reconnect in time')
	}

	async revoke(id: string) {
		return this.#runStateTransition(() => this.#revoke(id))
	}

	async #revoke(id: string) {
		const [connected, remembered] = await Promise.all([
			discoverThunderboltDevices(this.#devicesPath),
			this.#getRemembered(),
		])
		const device = connected.find((candidate) => candidate.id === id)
		const rememberedDevice = remembered.find((candidate) => candidate.id === id)
		if (!device && !rememberedDevice) throw new Error('Thunderbolt device is not known to Umbrel')

		if (device?.authorized) await this.#setSystemDeviceAuthorization(device, false)
		await this.#forget(id)
		if (device) this.#revokedUntilDisconnected.add(id)
		await this.#clearDeviceNotifications(id)

		return {
			...(device ?? rememberedDevice!),
			connected: Boolean(device),
			authorized: false,
			remembered: false,
		}
	}

	// Reapply remembered approvals before apps inspect attached hardware during
	// boot, then keep notifications in sync for newly attached devices.
	async reconcile() {
		this.#reconcileRequested = true
		if (this.#reconcilePromise) return this.#reconcilePromise

		const reconcilePromise = this.#runStateTransition(async () => {
			do {
				this.#reconcileRequested = false
				await this.#reconcile()
			} while (this.#reconcileRequested)
		})
		this.#reconcilePromise = reconcilePromise
		try {
			await reconcilePromise
		} finally {
			if (this.#reconcilePromise === reconcilePromise) this.#reconcilePromise = undefined
		}
	}

	async #reconcile() {
		const [devices, remembered, notifications] = await Promise.all([
			discoverThunderboltDevices(this.#devicesPath),
			this.#getRemembered(),
			this.#umbreld.notifications.get(),
		])
		const rememberedIds = new Set(remembered.map(({id}) => id))
		const connectedIds = new Set(devices.map(({id}) => id))
		const connectedNotifications = new Set(devices.map(({id}) => thunderboltNotification(id)))
		const activeNotifications = new Set<string>()
		for (const notification of this.#notificationDisconnectedAt.keys()) {
			if (!notifications.includes(notification)) this.#notificationDisconnectedAt.delete(notification)
		}
		for (const id of this.#revokedUntilDisconnected) {
			if (!connectedIds.has(id)) this.#revokedUntilDisconnected.delete(id)
		}

		for (const device of devices) {
			// Never restore UUID-only trust unless the kernel reports a known
			// compatible mode. Clear unsafe or unverifiable stored approvals first.
			if (!canPersistAuthorization(device.security) && rememberedIds.has(device.id)) {
				await this.#forget(device.id)
				rememberedIds.delete(device.id)
			}
			if (this.#revokedUntilDisconnected.has(device.id)) continue
			if (device.authorized) continue
			const notification = thunderboltNotification(device.id)

			if (rememberedIds.has(device.id)) {
				try {
					await this.#setSystemDeviceAuthorization(device, true)
					continue
				} catch (error) {
					this.logger.error(`Failed to re-authorize Thunderbolt device ${device.id}`, error)
					// A kernel authorization failure can make some devices disconnect and
					// immediately reappear. Retaining the approval would retry on every udev
					// event, trapping the device in an authorization loop with no usable UI
					// state. Fail closed: forget the approval and let the owner explicitly
					// retry once the hardware is stable.
					await this.#forget(device.id)
					rememberedIds.delete(device.id)
				}
			}

			activeNotifications.add(notification)
			this.#notificationDisconnectedAt.delete(notification)
			if (!notifications.includes(notification)) await this.#umbreld.notifications.add(notification)
		}

		for (const notification of notifications) {
			if (notification.startsWith(LEGACY_EXTERNAL_GPU_NOTIFICATION_PREFIX)) {
				await this.#umbreld.notifications.clear(notification)
				continue
			}
			if (!notification.startsWith(THUNDERBOLT_NOTIFICATION_PREFIX) || activeNotifications.has(notification)) continue

			// Clear immediately when the same device is still connected but no longer
			// needs approval. For a disappeared device, keep the prompt through a
			// short grace period so an unstable link cannot repeatedly open and close
			// the owner notification. The fallback scan eventually removes a genuinely
			// stale prompt even when no further udev event arrives.
			if (connectedNotifications.has(notification)) {
				this.#notificationDisconnectedAt.delete(notification)
				await this.#umbreld.notifications.clear(notification)
				continue
			}
			const now = this.#now()
			const disconnectedAt = this.#notificationDisconnectedAt.get(notification) ?? now
			this.#notificationDisconnectedAt.set(notification, disconnectedAt)
			if (now - disconnectedAt >= this.#notificationDisconnectGraceMs) {
				this.#notificationDisconnectedAt.delete(notification)
				await this.#umbreld.notifications.clear(notification)
			}
		}
	}

	// Emit a devices-change event whenever the user-visible device state differs
	// from what was last observed. Runs on the state transition queue after every
	// transition, so a change is announced exactly once whether it was caused by
	// us (authorize, revoke) or by the world (connect, disconnect, boot).
	async #emitDevicesChangeEvent() {
		try {
			const devices = await this.getDevices()
			const signature = JSON.stringify([...devices].sort((a, b) => a.id.localeCompare(b.id)))
			if (signature === this.#lastDevicesSignature) return
			this.#lastDevicesSignature = signature
			this.#umbreld.eventBus.emit('hardware:thunderbolt:devices-change')
		} catch (error) {
			// A failed check must never break the transition queue; the next
			// transition or periodic scan checks again from scratch.
			this.logger.error('Failed to check for Thunderbolt device changes', error)
		}
	}

	async #setSystemDeviceAuthorization(device: DiscoveredThunderboltDevice, authorized: boolean) {
		if (device.authorized === authorized) return
		const authorizedPath = nodePath.join(device.path, 'authorized')
		await this.#setDeviceAuthorization(authorizedPath, authorized)
		const currentValue = await readOptional(authorizedPath)
		if (
			(authorized && (!currentValue || currentValue === '0')) ||
			(!authorized && currentValue && currentValue !== '0')
		) {
			throw new Error(`Thunderbolt device remained ${authorized ? 'unauthorized' : 'authorized'}`)
		}
		this.logger.log(
			`${authorized ? 'Authorized' : 'Deauthorized'} Thunderbolt device ${device.vendor ?? ''} ${device.name ?? ''} (${device.id})`.trim(),
		)
	}

	async #getRemembered(): Promise<RememberedThunderboltDevice[]> {
		return (await this.#umbreld.store.get('authorizedThunderboltDevices')) ?? []
	}

	async #remember(device: DiscoveredThunderboltDevice) {
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const remembered = (await get('authorizedThunderboltDevices')) ?? []
			await set('authorizedThunderboltDevices', [
				...remembered.filter(({id}) => id !== device.id),
				{id: device.id, name: device.name, vendor: device.vendor},
			])
		})
	}

	async #forget(id: string) {
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const remembered = (await get('authorizedThunderboltDevices')) ?? []
			await set(
				'authorizedThunderboltDevices',
				remembered.filter((device) => device.id !== id),
			)
		})
	}

	#runStateTransition<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#stateTransitionTail.then(operation)
		// Keep the queue usable after a failed operation while returning the
		// original rejection to its caller. Every transition is followed by a
		// device change check on the same queue, so concurrent transitions can
		// never race their change detection.
		this.#stateTransitionTail = result
			.then(
				() => undefined,
				() => undefined,
			)
			.then(() => this.#emitDevicesChangeEvent())
		return result
	}

	async #clearDeviceNotifications(id: string) {
		this.#notificationDisconnectedAt.delete(thunderboltNotification(id))
		await Promise.all([
			this.#umbreld.notifications.clear(thunderboltNotification(id)),
			this.#umbreld.notifications.clear(legacyExternalGpuNotification(id)),
		])
	}
}
