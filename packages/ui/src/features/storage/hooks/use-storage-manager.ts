// Storage Manager's connection to umbreld: reads the storage and the drives, follows the task
// that is running, and turns what the screens ask for into the calls umbreld takes.

import {useEffect, useRef, useState} from 'react'

import {useIsUmbrelPro} from '@/hooks/use-is-umbrel-pro'

import {recordOf, TaskRecord, toStorageState} from '../from-umbreld'
import {usePendingRaidOperation} from '../providers/pending-operation-context'
import type {StorageAction, StorageState} from '../state'
import {useActiveRaidOperation} from './use-active-raid-operation'
import type {RaidProgress} from './use-raid-progress'
import {useStorage} from './use-storage'

// ---------------------------------------------------------------------------
// What this browser started
// ---------------------------------------------------------------------------

const RECORD_KEY = 'umbrel-storage-task'
// A record is kept this long without its task showing up: umbreld takes a moment to report one
const RECORD_GRACE_MS = 90_000

function readRecord(): TaskRecord | null {
	try {
		const stored = localStorage.getItem(RECORD_KEY)
		return stored ? (JSON.parse(stored) as TaskRecord) : null
	} catch {
		return null
	}
}

function writeRecord(record: TaskRecord | null) {
	try {
		if (record) localStorage.setItem(RECORD_KEY, JSON.stringify(record))
		else localStorage.removeItem(RECORD_KEY)
	} catch {
		// Without storage the task is simply shown without its drives
	}
}

// umbreld says a task is running, not which drives it involves. The browser that started it
// keeps that, across reloads and the restart a switch to FailSafe makes, until the task is over.
export function useTaskRecord(running: boolean) {
	const [record, setRecord] = useState<TaskRecord | null>(readRecord)
	const save = (next: TaskRecord | null) => {
		writeRecord(next)
		setRecord(next)
	}
	useEffect(() => {
		if (!record || running) return
		const wait = Math.max(0, record.at + RECORD_GRACE_MS - Date.now())
		const timer = setTimeout(() => save(null), wait)
		return () => clearTimeout(timer)
	}, [record, running])
	return [record, save] as const
}

// ---------------------------------------------------------------------------
// The moment a long task ends
// ---------------------------------------------------------------------------

const finishedKind = (type: RaidProgress['type']): NonNullable<StorageState['finished']>['kind'] | null =>
	type === 'failsafe-transition'
		? 'failsafe'
		: type === 'replace' || type === 'rebuild'
			? 'rebuild'
			: type === 'expansion'
				? 'expand'
				: null

// umbreld keeps no record of when a task ended, so this only exists for a Storage Manager that
// was open when it did
function useFinished(progress: RaidProgress | null) {
	const [finished, setFinished] = useState<StorageState['finished']>(null)
	const last = useRef<string | null>(null)
	useEffect(() => {
		const key = progress ? `${progress.type}:${progress.state}` : null
		if (key === last.current) return
		last.current = key
		if (!progress) return
		const done = progress.state === 'finished' || progress.state === 'complete'
		const kind = finishedKind(progress.type)
		if (done && kind) setFinished({kind, at: Date.now()})
		// A new task takes the last one's moment away
		else if (!done) setFinished(null)
	}, [progress])
	return finished
}

// ---------------------------------------------------------------------------
// The storage
// ---------------------------------------------------------------------------

// What the island shows from the click until umbreld's own events arrive
function pendingFor(action: StorageAction, instant: boolean): RaidProgress | null {
	if (action.type === 'check') return null
	if (action.type === 'failsafe') return {type: 'failsafe-transition', state: 'starting', progress: 0}
	if (action.type === 'replace' || action.type === 'repair') return {type: 'replace', state: 'starting', progress: 0}
	return {type: 'expansion', state: instant ? 'adding' : 'starting', progress: 0}
}

export function useStorageManager() {
	const identity = useIsUmbrelPro()
	// Kept fresh: polled for temperature and health, and read again on umbreld's events
	const storage = useStorage({pollInterval: 15_000})
	const {raidStatusQ: raidQ, devicesQ} = storage
	const progress = useActiveRaidOperation()
	const {setPendingOperation, clearPendingOperation, operationError, setOperationError} = usePendingRaidOperation()

	const running = !!progress && !['finished', 'complete', 'canceled', 'error'].includes(progress.state)
	const [record, saveRecord] = useTaskRecord(running)
	const finished = useFinished(progress)

	const raid = raidQ.data
	const devices = devicesQ.data
	const loading = identity.isLoading || raidQ.isLoading || devicesQ.isLoading
	// A failed refresh must not throw away what is already on screen, or close a sheet that is open
	const error =
		(!identity.hasData ? identity.error : undefined) ??
		(raid === undefined ? raidQ.error : undefined) ??
		(devices === undefined ? devicesQ.error : undefined)
	const retrying = identity.isFetching || raidQ.isFetching || devicesQ.isFetching
	const retry = () => {
		void identity.refetch()
		void raidQ.refetch()
		void devicesQ.refetch()
	}

	const state =
		raid?.exists && devices
			? toStorageState({
					raid,
					devices,
					isPro: identity.isUmbrelPro,
					progress,
					record,
					failsafeError:
						operationError ??
						(raid.failsafeTransitionStatus?.state === 'error' ? raid.failsafeTransitionStatus.error : null),
					finished,
				})
			: null

	// Asks umbreld for a change. Resolves once umbreld has taken it on, and rejects with its
	// refusal, which the sheet that asked shows.
	const run = async (action: StorageAction) => {
		const layout = state?.pool.layout
		// These are done the moment umbreld answers: nothing carries on afterwards
		const instant =
			action.type === 'addPair' || action.type === 'addAccel' || (action.type === 'add' && layout === 'stripe')
		// A working drive that is replaced stays part of the storage until the new one is ready
		const oldWasWorking =
			action.type === 'replace' &&
			[...(state?.pool.members ?? []), ...(state?.pool.accel ?? [])].some(
				(member) => member.id === action.memberId && member.state === 'online',
			)
		const pending = pendingFor(action, instant)
		if (pending) setPendingOperation(pending)
		setOperationError(null)
		try {
			if (action.type === 'replace') {
				await storage.replaceDeviceAsync({oldDevice: action.memberId, newDevice: action.newId})
			} else if (action.type === 'repair') {
				// The same drive, erased and rebuilt where it is
				await storage.replaceDeviceAsync({oldDevice: action.memberId, newDevice: action.memberId})
			} else if (action.type === 'add') {
				await storage.addDeviceAsync({deviceId: action.id})
			} else if (action.type === 'addPair') {
				await storage.addMirrorAsync({deviceIds: action.ids})
			} else if (action.type === 'addAccel') {
				await storage.addAcceleratorAsync({deviceIds: action.ids})
			} else if (action.type === 'check') {
				await storage.scrubAsync()
			} else if (action.to === 'mirror') {
				await storage.transitionToFailsafeMirrorAsync({
					pairs: action.pairs.map((pair) => ({existingDeviceId: pair.existingId, newDeviceId: pair.newId})),
					acceleratorDeviceId: action.accelId,
				})
			} else {
				await storage.transitionToFailsafeRaidzAsync({
					newDeviceId: action.newIds[0],
					secondNewDeviceId: action.newIds[1],
					failsafeLayout: action.to,
					acceleratorDeviceId: action.accelId,
				})
			}
		} catch (cause) {
			clearPendingOperation()
			throw cause
		}
		saveRecord(instant ? null : recordOf(action, Date.now(), oldWasWorking))
		if (instant) {
			setPendingOperation({type: 'expansion', state: 'finished', progress: 100})
			setTimeout(clearPendingOperation, 2000)
		}
	}

	return {
		isPro: identity.isUmbrelPro,
		raid,
		devices,
		loading,
		error,
		retry,
		retrying,
		state,
		run,
	}
}
