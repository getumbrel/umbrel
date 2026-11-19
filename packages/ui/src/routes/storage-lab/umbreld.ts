// Storage lab: a pretend umbreld that speaks umbreld's own language.
//
// The other lab pages hand the screens a ready-made StorageState. This one answers the same
// calls the real umbreld answers (hardware.raid.getStatus, hardware.internalStorage.getDevices,
// the mutations, the progress events), in the shapes umbreld uses, so the real Storage Manager
// from Settings can run on any scenario: its reading of umbreld, its requests and all.

import {TRPCClientError, type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'

import type {Drive} from '@/features/storage/model'
import {Member, Operation, StorageAction, viewPool} from '@/features/storage/state'

import type {AppRouter} from '../../../../umbreld/source/modules/server/trpc/common'
import {request, restarted, Sim, SimEvent, simReducer} from './sim'

// The file system keeps a little of every drive for itself
const OVERHEAD = 0.967

const zfsStatus = (member: Member, drive: Drive | undefined) => {
	if (member.state === 'failed') return 'FAULTED'
	if (member.state === 'missing' || member.state === 'unusable') return 'UNAVAIL'
	// A drive being rebuilt or added is in use already
	return drive?.degraded ? 'DEGRADED' : 'ONLINE'
}

// hardware.raid.getStatus
export function toRaidStatus(sim: Sim) {
	const view = viewPool(sim)
	const {layout, members, accel, partialPairs} = sim.pool
	const op = sim.op
	const listed = [...members]
	// While a working drive is replaced, the storage lists it beside its replacement
	if (op?.kind === 'rebuild' && op.oldId && view.driveOf(op.oldId)) {
		const at = Math.max(
			0,
			listed.findIndex((member) => member.id === op.memberId),
		)
		listed.splice(at, 0, {id: op.oldId, state: 'online'})
	}
	const entry = (member: Member) => {
		const drive = view.driveOf(member.id)
		return {
			id: member.id,
			size: Math.round((drive?.size ?? 0) * 0.9995),
			status: zfsStatus(member, drive),
			readErrors: 0,
			writeErrors: 0,
			checksumErrors: drive?.errors ?? 0,
		}
	}
	const special = accel.length > 0 ? (sim.pool.accelRoom ?? 0) : 0
	const topology = layout === 'mirror' || partialPairs ? 'mirror' : layout === 'stripe' ? 'stripe' : 'raidz'
	const usable = view.capacity.usable * OVERHEAD
	const troubled =
		view.down.length > 0 || view.accelDown.length > 0 || view.memberDrives.some((drive) => drive.degraded)
	let mirrors =
		layout === 'mirror' ? view.capacity.pairs.map((pair) => [...pair]) : partialPairs?.map((pair) => [...pair])
	// A pair that is having a drive replaced is listed with only its other drive
	if (mirrors && op?.kind === 'rebuild' && op.memberId) {
		mirrors = mirrors.map((pair) => pair.filter((id) => id !== op.memberId))
	}
	const transition = (current: Extract<Operation, {kind: 'failsafe'}>) => ({
		state: current.phase === 'copying' ? 'syncing' : current.phase === 'restarting' ? 'rebooting' : 'rebuilding',
		progress: current.progress,
	})
	return {
		name: 'umbrelos',
		exists: true,
		// umbreld only calls it FailSafe when everything is protected, the acceleration SSDs too
		raidType: layout === 'stripe' || accel.length === 1 ? 'storage' : 'failsafe',
		topology,
		raidzParity: layout === 'raidz2' ? 2 : layout === 'raidz1' ? 1 : undefined,
		// umbreld hides the degraded state of a storage that is only finishing its switch
		status:
			view.status === 'offline'
				? 'UNAVAIL'
				: troubled && !(op?.kind === 'failsafe' && op.phase === 'rebuilding')
					? 'DEGRADED'
					: 'ONLINE',
		devices: listed.map(entry),
		mirrors,
		totalSpace:
			topology === 'mirror'
				? listed.reduce((sum, member) => sum + (view.driveOf(member.id)?.size ?? 0), 0)
				: (view.capacity.usable + view.capacity.protection) * OVERHEAD + special,
		usableSpace: usable + special,
		usedSpace: sim.pool.used * OVERHEAD,
		freeSpace: usable + special - sim.pool.used * OVERHEAD,
		dataErrors: sim.pool.dataErrors,
		accelerator: {
			exists: accel.length > 0,
			l2arcSize: special,
			specialSize: special,
			specialFreeSpace: special * (1 - (sim.pool.accelUsed ?? 0)),
			devices: accel.map(entry),
		},
		expansion: op?.kind === 'expand' ? {state: 'expanding', progress: op.progress} : undefined,
		rebuild: op?.kind === 'rebuild' ? {state: 'rebuilding', progress: op.progress} : undefined,
		replace: op?.kind === 'rebuild' ? {state: 'rebuilding', progress: op.progress} : undefined,
		scrub: op?.kind === 'check' ? {state: 'scrubbing', progress: op.progress, errors: 0} : undefined,
		failsafeTransitionStatus:
			op?.kind === 'failsafe'
				? transition(op)
				: sim.failsafeError
					? {state: 'error', progress: 0, error: sim.failsafeError}
					: partialPairs
						? {state: 'error', progress: 0, error: 'FailSafe was only partly enabled.'}
						: undefined,
	}
}

// hardware.internalStorage.getDevices: the drives the machine can see
export function toDevices(sim: Sim) {
	return sim.drives
		.filter((drive) => !drive.absent)
		.map((drive, index) => ({
			type: drive.kind,
			transport: drive.kind === 'ssd' && drive.temperatureWarning !== undefined ? 'nvme' : 'sata',
			device: drive.kind === 'ssd' ? `nvme${index}n1` : `sd${String.fromCharCode(97 + index)}`,
			id: drive.id,
			slot: drive.slot,
			name: drive.model,
			model: drive.model,
			serial: drive.serial,
			size: Math.round(drive.size * 1.0002),
			roundedSize: drive.size,
			temperature: drive.temperature,
			temperatureWarning: drive.temperatureWarning,
			temperatureCritical: drive.temperatureCritical,
			lifetimeUsed: drive.lifetimeUsed,
			smartStatus: drive.smart,
			isSystemDrive: !!drive.system,
		}))
}

const eventOf = (op: Operation) =>
	op.kind === 'rebuild'
		? 'raid:replace-progress'
		: op.kind === 'expand'
			? 'raid:expansion-progress'
			: op.kind === 'check'
				? 'raid:scrub-progress'
				: 'raid:failsafe-transition-progress'

const progressOf = (op: Operation) => {
	if (op.kind === 'failsafe') {
		const state = op.phase === 'copying' ? 'syncing' : op.phase === 'restarting' ? 'rebooting' : 'rebuilding'
		return {state, progress: op.progress}
	}
	if (op.kind === 'check') return {state: 'scrubbing', progress: op.progress, errors: 0}
	return {state: op.kind === 'expand' ? 'expanding' : 'rebuilding', progress: op.progress}
}

const finalOf = (op: Operation, dataErrors: number) =>
	op.kind === 'failsafe'
		? {state: 'complete', progress: 100}
		: op.kind === 'check'
			? {state: 'finished', progress: 100, errors: dataErrors}
			: {state: 'finished', progress: 100}

// What the storage is made of, apart from how far a task has got
const shapeOf = (sim: Sim) =>
	JSON.stringify([
		sim.pool.layout,
		sim.pool.members,
		sim.pool.accel,
		sim.drives.map((drive) => [drive.id, drive.absent]),
	])

export function createPretendUmbreld(initial: Sim, options: {usb?: boolean} = {}) {
	let sim = initial
	let refusing = false
	const listeners = new Map<string, Set<(data: unknown) => void>>()
	const watchers = new Set<() => void>()
	const emit = (event: string, data: unknown = {}) => listeners.get(event)?.forEach((listener) => listener(data))

	// Everything that changes the storage goes through here, so every change is announced the
	// way umbreld announces it
	const commit = (next: Sim) => {
		const before = sim
		sim = next
		if (next.op) emit(eventOf(next.op), progressOf(next.op))
		else if (before.op) emit(eventOf(before.op), finalOf(before.op, next.pool.dataErrors))
		if (shapeOf(before) !== shapeOf(next)) {
			emit('raid:status-change')
			emit('system:disk:change')
		}
		watchers.forEach((watcher) => watcher())
	}

	const toAction = (path: string, input: unknown): StorageAction => {
		const given = (input ?? {}) as Record<string, never>
		switch (path) {
			case 'hardware.raid.replaceDevice':
				return given.oldDevice === given.newDevice
					? {type: 'repair', memberId: given.oldDevice}
					: {type: 'replace', memberId: given.oldDevice, newId: given.newDevice}
			case 'hardware.raid.addDevice':
				return {type: 'add', id: given.deviceId}
			case 'hardware.raid.addMirror':
				return {type: 'addPair', ids: given.deviceIds}
			case 'hardware.raid.addAccelerator':
				return {type: 'addAccel', ids: given.deviceIds}
			case 'hardware.raid.scrub':
				return {type: 'check'}
			case 'hardware.raid.transitionToFailsafeMirror':
				return {
					type: 'failsafe',
					to: 'mirror',
					pairs: (given.pairs as {existingDeviceId: string; newDeviceId: string}[]).map((pair) => ({
						existingId: pair.existingDeviceId,
						newId: pair.newDeviceId,
					})),
					accelId: given.acceleratorDeviceId,
				}
			case 'hardware.raid.transitionToFailsafeRaidz':
				return {
					type: 'failsafe',
					to: given.failsafeLayout ?? 'raidz1',
					newIds: [given.newDeviceId, given.secondNewDeviceId].filter(Boolean),
					accelId: given.acceleratorDeviceId,
				}
		}
		throw new Error(`No pretend answer for ${path}`)
	}

	const answer = (path: string): unknown => {
		switch (path) {
			case 'hardware.umbrelPro.isUmbrelPro':
				return sim.device === 'pro'
			case 'hardware.raid.getStatus':
				return toRaidStatus(sim)
			case 'hardware.internalStorage.getDevices':
				return toDevices(sim)
			case 'user.get':
				return {role: 'owner', name: 'Alex', temperatureUnit: 'c'}
			case 'system.memorySize':
				return 16 * 2 ** 30
			case 'files.externalDevices':
				return options.usb
					? [
							{
								id: 'usb-1',
								name: 'Samsung T7',
								size: 2_000_000_000_000,
								partitions: [{label: 'Samsung T7', mountpoints: ['/External/Samsung T7']}],
							},
						]
					: []
		}
		return null
	}

	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				if (op.type === 'subscription') {
					const {event} = op.input as {event: string}
					const listener = (data: unknown) => observer.next({result: {type: 'data', data}})
					if (!listeners.has(event)) listeners.set(event, new Set())
					listeners.get(event)!.add(listener)
					return () => listeners.get(event)?.delete(listener)
				}
				if (op.type === 'query') {
					observer.next({result: {data: answer(op.path)}})
					observer.complete()
					return
				}
				// A request takes a moment, and umbreld can refuse it
				const timer = setTimeout(() => {
					try {
						if (refusing) {
							refusing = false
							watchers.forEach((watcher) => watcher())
							throw new Error(
								'Command failed with exit code 1: zpool: cannot open ‘umbrelos’: pool I/O is currently suspended',
							)
						}
						commit(request(sim, toAction(op.path, op.input)))
						observer.next({result: {data: true}})
						observer.complete()
					} catch (cause) {
						observer.error(TRPCClientError.from(cause as Error))
					}
				}, 900)
				return () => clearTimeout(timer)
			})

	return {
		link,
		get sim() {
			return sim
		},
		get refusing() {
			return refusing
		},
		setRefusing(next: boolean) {
			refusing = next
			watchers.forEach((watcher) => watcher())
		},
		// Time passing, and what only hardware can do
		dispatch: (event: SimEvent) => commit(simReducer(sim, event)),
		// umbrelOS coming back from the restart a switch to FailSafe makes
		restart: () => commit(restarted(sim)),
		watch(watcher: () => void) {
			watchers.add(watcher)
			return () => {
				watchers.delete(watcher)
			}
		},
	}
}

export type PretendUmbreld = ReturnType<typeof createPretendUmbreld>
