import {useCallback, useContext, useEffect, useMemo, useReducer, useRef, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'
import {AiOutlineFileExclamation} from 'react-icons/ai'

import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {AUTH_TOKEN_LOCAL_STORAGE_KEY} from '@/modules/auth/token-renewal'
import {ConfirmationContext, useConfirmation} from '@/providers/confirmation'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'

import {transfers} from './transfers'
import {
	isTerminalTransferState,
	type CollisionDecision,
	type TransferBatch,
	type TransferItem,
	type TransferKind,
	type TransfersSnapshot,
} from './types'

type OperationProgress = RouterOutput['files']['operationProgress'][number]

// Rows a batch shows before collapsing the rest into "+N more"
const MAX_ROWS = 5
// A row that just completed stays put with its check for this long, then
// leaves; the rows below glide up into its place
export const LANDED_MS = 900
// Landed rows are extra, above the window, so the bottom of the list never
// churns as items complete
const MAX_LANDED_ROWS = 2

export const isLanded = (item: TransferItem, now: number) =>
	item.state === 'completed' && item.settledAt !== undefined && now - item.settledAt < LANDED_MS

export function useTransfersSnapshot() {
	return useSyncExternalStore(transfers.subscribe, transfers.snapshot)
}

export function useTransferItem(id: string | null | undefined) {
	return useSyncExternalStore(transfers.subscribe, () => (id ? transfers.snapshot().items.get(id) : undefined))
}

// --- View model -------------------------------------------------------------

export type TransferBatchView = {
	id: string
	kind: TransferKind
	destinationDirectory: string
	destinationName: string
	items: TransferItem[]
	// The rows worth showing: what needs the user first, then, in queue order,
	// what just landed, what is running and what waits. Other settled rows are
	// summarised in the counts instead.
	rows: TransferItem[]
	hiddenCount: number
	counts: {
		// Items still meant to land: everything but cancelled and skipped
		total: number
		completed: number
		queued: number
		running: number
		attention: number
		failed: number
		cancelled: number
		skipped: number
	}
	progress: number
	transferredBytes: number
	totalBytes: number
	bytesPerSecond: number
	secondsRemaining?: number
	cancellable: boolean
	collisionDecision?: CollisionDecision
	status: 'active' | 'attention' | 'failed' | 'done'
}

export type TransfersView = {
	batches: TransferBatchView[]
	// What the island holds, so it can call itself Uploads, Copying, Moving
	// or, for a mix, Transfers
	kind: TransferKind | 'mixed'
	// The batch the pill speaks for: the one with work in flight, else the
	// first that is not settled, else the first
	primary?: TransferBatchView
	counts: {running: number; queued: number; attention: number; failed: number}
	cancellable: boolean
	// Progress records for work the Files island does not present: app storage
	// moves and Rewind restores, which have their own surfaces
	managedOperations: OperationProgress[]
	// Uploads and not-yet-sent server work die with the page
	hasBrowserBoundWork: boolean
	// A collision dialog is up for one of the rows
	promptOpen: boolean
	wake: number
}

const isInFlight = (item: TransferItem) =>
	item.state === 'running' || item.state === 'finishing' || item.state === 'cancelling'

const dirname = (path: string) => path.substring(0, path.lastIndexOf('/')) || '/'

// A server record is the item's own when kind, source and destination folder
// all agree; the same source can be copied to two places at once
const operationKey = (kind: TransferKind, sourcePath: string, destinationDirectory: string) =>
	`${kind}:${sourcePath}→${destinationDirectory}`

function matchesOperation(item: TransferItem, operation: OperationProgress) {
	return (
		operation.type === item.kind &&
		operation.file.path === item.sourcePath &&
		dirname(operation.destinationPath) === item.destinationDirectory
	)
}

// Copies and moves run on the server; their live figures arrive through the
// operation-progress stream and are laid over the queue's own record here
function withServerProgress(item: TransferItem, operations: OperationProgress[]) {
	if (item.kind === 'upload' || !isInFlight(item)) return item
	const operation = operations.find((op) => matchesOperation(item, op))
	if (!operation) return item
	return {
		...item,
		progress: operation.percent,
		bytesPerSecond: operation.bytesPerSecond,
		secondsRemaining: operation.secondsRemaining,
	}
}

function buildBatchView(
	batch: TransferBatch,
	snapshot: TransfersSnapshot,
	operations: OperationProgress[],
	now: number,
) {
	const items = batch.itemIds
		.map((id) => snapshot.items.get(id))
		.filter((item): item is TransferItem => item !== undefined)
		.map((item) => withServerProgress(item, operations))

	const counts = {total: 0, completed: 0, queued: 0, running: 0, attention: 0, failed: 0, cancelled: 0, skipped: 0}
	let transferredBytes = 0
	let totalBytes = 0
	let bytesPerSecond = 0
	let serverProgress = 0
	let secondsRemaining: number | undefined
	for (const item of items) {
		switch (item.state) {
			case 'queued':
				counts.queued++
				break
			case 'running':
			case 'finishing':
			case 'cancelling':
				counts.running++
				break
			case 'needs-attention':
				counts.attention++
				break
			case 'failed':
				counts.failed++
				break
			case 'completed':
				counts.completed++
				break
			case 'cancelled':
				counts.cancelled++
				continue
			case 'skipped':
				counts.skipped++
				continue
		}
		counts.total++
		totalBytes += item.size ?? 0
		if (item.state === 'completed') transferredBytes += item.size ?? 0
		else if (isInFlight(item)) {
			transferredBytes += item.transferredBytes
			bytesPerSecond += item.bytesPerSecond
			serverProgress += item.progress / 100
			if (item.secondsRemaining !== undefined) {
				secondsRemaining = Math.max(secondsRemaining ?? 0, item.secondsRemaining)
			}
		}
	}

	let progress: number
	if (batch.kind === 'upload') {
		if (totalBytes > 0) progress = (transferredBytes / totalBytes) * 100
		else progress = counts.total > 0 ? (counts.completed / counts.total) * 100 : 0
		if (bytesPerSecond > 0) secondsRemaining = Math.round((totalBytes - transferredBytes) / bytesPerSecond)
	} else {
		progress = counts.total > 0 ? ((counts.completed + serverProgress) / counts.total) * 100 : 0
	}

	// Queue order is already the order things happen in: FIFO means the running
	// items are the earliest queued ones. Keeping that order stops rows from
	// jumping when they start; only items that need the user rise to the top.
	const attention = items.filter((item) => item.state === 'needs-attention' || item.state === 'failed')
	const landed = items.filter((item) => isLanded(item, now)).slice(-MAX_LANDED_ROWS)
	const flow = items.filter((item) => isInFlight(item) || item.state === 'queued')
	const shownAttention = attention.slice(0, MAX_ROWS)
	const shownFlow = flow.slice(0, Math.max(0, MAX_ROWS - shownAttention.length))
	const rows = [...shownAttention, ...landed, ...shownFlow]
	const hiddenCount = attention.length - shownAttention.length + flow.length - shownFlow.length

	const status: TransferBatchView['status'] =
		counts.attention > 0
			? 'attention'
			: counts.queued + counts.running > 0
				? 'active'
				: counts.failed > 0
					? 'failed'
					: 'done'

	return {
		id: batch.id,
		kind: batch.kind,
		destinationDirectory: batch.destinationDirectory,
		destinationName: batch.destinationDirectory.split('/').filter(Boolean).pop() ?? batch.destinationDirectory,
		items,
		rows,
		hiddenCount,
		counts,
		progress: Math.min(100, Math.max(0, progress)),
		transferredBytes,
		totalBytes,
		bytesPerSecond,
		secondsRemaining,
		cancellable: items.some((item) => transfers.isCancellable(item.id)),
		collisionDecision: batch.collisionDecision,
		status,
	} satisfies TransferBatchView
}

// A queue item claims its server progress record while it runs, and for a
// moment after it settles: the record can outlive the mutation's response by
// a few milliseconds, and must not flash up as unowned work in between
const CLAIM_GRACE_MS = 2000

// Ordinary copies and moves the server is running that no batch here owns: a
// copy started before the page reloaded, or from another tab. They are
// presented like any other batch, read-only, so all of Files' transfer work
// lives in one place. App storage moves and Rewind restores are not ordinary
// and keep their own surfaces.
function isManagedOperation(operation: OperationProgress) {
	return operation.appId !== undefined || operation.file.path.startsWith('/Backups/')
}

function buildOperationBatchView(operation: OperationProgress): TransferBatchView {
	const destinationDirectory = operation.destinationPath.substring(0, operation.destinationPath.lastIndexOf('/')) || '/'
	const item: TransferItem = {
		id: `operation:${operation.id}`,
		batchId: `operation:${operation.id}`,
		kind: operation.type,
		lane: 'streamed',
		name: operation.file.name,
		type: operation.file.type,
		size: operation.file.size,
		sourcePath: operation.file.path,
		path: operation.destinationPath,
		destinationDirectory,
		state: 'running',
		progress: operation.percent,
		transferredBytes: 0,
		bytesPerSecond: operation.bytesPerSecond,
		secondsRemaining: operation.secondsRemaining,
		attempts: 1,
	}
	return {
		id: item.batchId,
		kind: operation.type,
		destinationDirectory,
		destinationName: destinationDirectory.split('/').filter(Boolean).pop() ?? destinationDirectory,
		items: [item],
		rows: [item],
		hiddenCount: 0,
		counts: {total: 1, completed: 0, queued: 0, running: 1, attention: 0, failed: 0, cancelled: 0, skipped: 0},
		progress: Math.min(100, Math.max(0, operation.percent)),
		transferredBytes: 0,
		totalBytes: 0,
		bytesPerSecond: operation.bytesPerSecond,
		secondsRemaining: operation.secondsRemaining,
		cancellable: false,
		status: 'active',
	}
}

export function buildTransfersView(
	snapshot: TransfersSnapshot,
	operations: OperationProgress[],
	now = Date.now(),
): TransfersView {
	const claimed = new Set<string>()
	for (const item of snapshot.items.values()) {
		if (item.kind === 'upload' || !item.sourcePath) continue
		const recent = item.settledAt !== undefined && now - item.settledAt < CLAIM_GRACE_MS
		if (isInFlight(item) || recent) claimed.add(operationKey(item.kind, item.sourcePath, item.destinationDirectory))
	}
	const isClaimed = (operation: OperationProgress) =>
		claimed.has(operationKey(operation.type, operation.file.path, dirname(operation.destinationPath)))
	const unowned = operations.filter((operation) => !isClaimed(operation) && !isManagedOperation(operation))
	const managedOperations = operations.filter((operation) => !isClaimed(operation) && isManagedOperation(operation))

	// Server work that predates this page's batches comes first: it is older
	const batches = [
		...unowned.map(buildOperationBatchView),
		...snapshot.batches.map((batch) => buildBatchView(batch, snapshot, operations, now)),
	]
	const counts = {running: 0, queued: 0, attention: 0, failed: 0}
	for (const batch of batches) {
		counts.running += batch.counts.running
		counts.queued += batch.counts.queued
		counts.attention += batch.counts.attention
		counts.failed += batch.counts.failed
	}
	const primary =
		batches.find((batch) => batch.counts.running > 0) ??
		batches.find((batch) => batch.status === 'active' || batch.status === 'attention') ??
		batches[0]

	let hasBrowserBoundWork = false
	let promptOpen = false
	for (const item of snapshot.items.values()) {
		if (item.state === 'needs-attention' && item.conflict && !item.conflict.dismissed) promptOpen = true
		if (isTerminalTransferState(item.state)) continue
		if (item.kind === 'upload' || !isInFlight(item)) hasBrowserBoundWork = true
	}

	const kinds = new Set(batches.map((batch) => batch.kind))
	const kind: TransfersView['kind'] = kinds.size === 1 ? batches[0].kind : kinds.size === 0 ? 'upload' : 'mixed'

	return {
		batches,
		kind,
		primary,
		counts,
		cancellable: batches.some((batch) => batch.cancellable),
		managedOperations,
		hasBrowserBoundWork,
		promptOpen,
		wake: snapshot.wake,
	}
}

// The earliest moment a landed row is due to leave, if any
function nextLandedExpiry(snapshot: TransfersSnapshot, now: number) {
	let next: number | undefined
	for (const item of snapshot.items.values()) {
		if (!isLanded(item, now)) continue
		const due = item.settledAt! + LANDED_MS
		if (next === undefined || due < next) next = due
	}
	return next
}

export function useTransfersView(operations: OperationProgress[]) {
	const snapshot = useTransfersSnapshot()
	// Landed rows leave on a clock, not on a store change: re-derive the view
	// when the next one is due
	const [clock, tick] = useReducer((count: number) => count + 1, 0)
	const view = useMemo(() => buildTransfersView(snapshot, operations, Date.now()), [snapshot, operations, clock])
	useEffect(() => {
		const due = nextLandedExpiry(snapshot, Date.now())
		if (due === undefined) return
		const timer = setTimeout(tick, Math.max(0, due - Date.now()) + 16)
		return () => clearTimeout(timer)
	}, [snapshot, clock])
	return view
}

// --- Listing integration ----------------------------------------------------

// Uploads heading into `path`, as rows the directory listing can render in
// place: files with live progress, and a placeholder folder for each dropped
// folder until the server has created it
export function useUploadListingItems(path: string): FileSystemItem[] {
	const snapshot = useTransfersSnapshot()
	return useMemo(() => {
		const prefix = path === '/' ? '/' : `${path}/`
		const rows: FileSystemItem[] = []
		const folders = new Map<string, {item: FileSystemItem; transferred: number; total: number}>()
		for (const item of snapshot.items.values()) {
			if (item.kind !== 'upload') continue
			if (item.state === 'completed') {
				// Landed: hold the row, as an ordinary item, until the server's
				// listing has shown it; keep-both may have renamed it. Once
				// listed, the server is the only truth, so a later delete or
				// rename must not bring the row back.
				if (item.listed) continue
				const landedPath = item.resultPath ?? item.path
				if (landedPath.substring(0, landedPath.lastIndexOf('/')) !== path) continue
				rows.push({
					name: landedPath.slice(landedPath.lastIndexOf('/') + 1),
					path: landedPath,
					type: item.type,
					size: item.size,
					modified: item.settledAt ?? Date.now(),
					operations: [],
					capabilitiesPending: true,
					tempId: item.id,
				})
				continue
			}
			if (isTerminalTransferState(item.state)) continue
			const createdAt = snapshot.batches.find((batch) => batch.id === item.batchId)?.createdAt ?? 0
			if (item.destinationDirectory === path) {
				rows.push({
					name: item.name,
					path: item.path,
					type: item.type,
					size: item.size,
					modified: createdAt,
					operations: [],
					thumbnail: transfers.thumbnailUrl(item.id),
					isUploading: true,
					progress: item.progress,
					speed: item.bytesPerSecond,
					tempId: item.id,
				})
			} else if (item.destinationDirectory.startsWith(prefix)) {
				const name = item.destinationDirectory.slice(prefix.length).split('/')[0]
				const folderPath = `${prefix}${name}`
				const folder = folders.get(folderPath) ?? {
					item: {
						name,
						path: folderPath,
						type: 'directory',
						modified: createdAt,
						operations: [],
						isUploading: true,
						progress: 0,
						speed: 0,
						tempId: `folder:${folderPath}`,
					},
					transferred: 0,
					total: 0,
				}
				folder.total += item.size ?? 0
				folder.transferred += item.transferredBytes
				folders.set(folderPath, folder)
			}
		}
		for (const {item, transferred, total} of folders.values()) {
			rows.push({...item, progress: total > 0 ? (transferred / total) * 100 : 0})
		}
		return rows
	}, [snapshot, path])
}

// --- Effects (mounted once, app-wide) --------------------------------------

export function useTransfersEffects() {
	const snapshot = useTransfersSnapshot()
	useConflictPrompts(snapshot)
	useTransferSideEffects()
	useLeavePageGuard(snapshot)
	useSignOutReset()
}

// A sign-out in any tab ends this tab's transfers too: every request is
// authorized server-side by the token it carries, so without one they would
// only fail one by one
function useSignOutReset() {
	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key === AUTH_TOKEN_LOCAL_STORAGE_KEY && event.newValue === null) transfers.reset()
		}
		window.addEventListener('storage', onStorage)
		return () => window.removeEventListener('storage', onStorage)
	}, [])
}

// One collision dialog at a time, oldest first. A dismissed dialog leaves the
// item waiting with a Resolve control; an answer for an item that was
// cancelled meanwhile is ignored by the queue.
function useConflictPrompts(snapshot: TransfersSnapshot) {
	const confirm = useConfirmation()
	// The provider shows one dialog and keeps one answer. A prompt raised
	// while another dialog is up (a cancel confirmation, say) would orphan
	// it, so conflicts wait for the dialog to close.
	const dialogOpen = useContext(ConfirmationContext)?.isOpen ?? false
	const {t} = useTranslation()
	const activeRef = useRef<string | null>(null)
	const [closedCount, promptClosed] = useReducer((count: number) => count + 1, 0)

	const next = useMemo(() => {
		for (const batch of snapshot.batches) {
			for (const id of batch.itemIds) {
				const item = snapshot.items.get(id)
				if (item?.state === 'needs-attention' && !item.conflict?.dismissed) return item
			}
		}
		return undefined
	}, [snapshot])

	useEffect(() => {
		if (!next || activeRef.current || dialogOpen) return
		const item = next
		activeRef.current = item.id
		const batch = snapshot.batches.find((candidate) => candidate.id === item.batchId)
		const remaining =
			batch?.itemIds.filter((id) => {
				const other = snapshot.items.get(id)
				return other && other.id !== item.id && !isTerminalTransferState(other.state)
			}).length ?? 0
		const destinationName = item.destinationDirectory.split('/').filter(Boolean).pop() ?? ''
		confirm({
			title: t('files-collision.title', {
				itemName: splitFileName(item.name).name,
				destinationName: `"${destinationName}"`,
			}),
			message: t('files-collision.message'),
			actions: [
				{label: t('files-collision.action.keep-both'), value: 'keep-both', variant: 'primary'},
				{label: t('files-collision.action.replace'), value: 'replace', variant: 'default'},
				{label: t('files-collision.action.skip'), value: 'skip', variant: 'default'},
			],
			// "Apply to remaining" whenever the batch has anything left, not
			// only once several conflicts have piled up
			showApplyToAll: remaining > 0,
			icon: AiOutlineFileExclamation,
		})
			.then((result) => transfers.resolveConflict(item.id, result.actionValue as CollisionDecision, result.applyToAll))
			.catch(() => transfers.dismissConflict(item.id))
			.finally(() => {
				activeRef.current = null
				promptClosed()
			})
		// closedCount re-arms the prompt for the next item once a dialog closes
	}, [next, snapshot, confirm, t, closedCount, dialogOpen])
}

// Listings, recents and the moving treatment follow the queue's transitions
function useTransferSideEffects() {
	const utils = trpcReact.useUtils()
	const invalidateListing = useThrottledListingInvalidation()

	useEffect(
		() =>
			transfers.onTransition((item, previous) => {
				if (item.kind === 'upload') {
					if (item.state !== 'completed') return
					// A folder upload lands files deep inside a tree the server
					// created on the fly. Refresh every folder from the file's own
					// up to the one the user dropped into, so the new folders show
					// there too; External and Network have no watcher to do it.
					const batch = transfers.snapshot().batches.find((candidate) => candidate.id === item.batchId)
					const root = batch?.destinationDirectory ?? item.destinationDirectory
					let directory = item.destinationDirectory
					while (true) {
						invalidateListing(directory)
						if (directory === root || !directory.startsWith(`${root === '/' ? '' : root}/`)) break
						directory = dirname(directory)
					}
					return
				}
				const store = useFilesStore.getState()
				if (item.kind === 'move' && item.sourcePath) {
					// A running move shows its source as busy; a finished one hides
					// the source until the listing confirms it is gone
					if (item.state === 'running') store.addPendingPaths([item.sourcePath], 'processing')
					else if (item.state === 'completed') store.addPendingPaths([item.sourcePath], 'removing')
					else if (previous === 'running' || previous === 'finishing' || previous === 'cancelling') {
						store.removePendingPaths([item.sourcePath])
					}
				}
				if (item.state === 'completed' || item.state === 'failed') {
					utils.files.list.invalidate()
					utils.files.recents.invalidate()
					utils.files.search.invalidate()
					if (item.kind === 'move') {
						utils.files.favorites.invalidate()
						utils.files.shares.invalidate()
					}
				}
			}),
		[utils, invalidateListing],
	)
}

// A single upload refreshes its folder at once; a burst of small files
// refreshes each folder at most twice a second
const LISTING_INVALIDATION_INTERVAL_MS = 500

function useThrottledListingInvalidation() {
	const utils = trpcReact.useUtils()
	const pendingRef = useRef(new Set<string>())
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

	useEffect(() => () => clearTimeout(timerRef.current), [])

	return useCallback(
		(path: string) => {
			pendingRef.current.add(path)
			if (timerRef.current) return
			const flush = () => {
				const paths = [...pendingRef.current]
				pendingRef.current.clear()
				for (const pending of paths) utils.files.list.invalidate({path: pending})
			}
			flush()
			const tick = () => {
				if (pendingRef.current.size === 0) {
					timerRef.current = undefined
					return
				}
				flush()
				timerRef.current = setTimeout(tick, LISTING_INVALIDATION_INTERVAL_MS)
			}
			timerRef.current = setTimeout(tick, LISTING_INVALIDATION_INTERVAL_MS)
		},
		[utils],
	)
}

function useLeavePageGuard(snapshot: TransfersSnapshot) {
	let hasBrowserBoundWork = false
	for (const item of snapshot.items.values()) {
		if (isTerminalTransferState(item.state)) continue
		if (item.kind === 'upload' || !isInFlight(item)) {
			hasBrowserBoundWork = true
			break
		}
	}
	useEffect(() => {
		if (!hasBrowserBoundWork) return
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault()
			// Legacy browsers need a value to show their prompt
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', warn)
		return () => window.removeEventListener('beforeunload', warn)
	}, [hasBrowserBoundWork])
}
