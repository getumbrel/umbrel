import {useTranslation} from 'react-i18next'
import {AiOutlineFileExclamation} from 'react-icons/ai'

import {toast} from '@/components/ui/toast'
import {TRASH_PATH} from '@/features/files/constants'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {useConfirmation} from '@/providers/confirmation'
import {trpcReact} from '@/trpc/trpc'

// Define a type for the operation function signature used by the helper
type OperationAsyncFn<TArgs extends object, TResult = any> = (args: TArgs) => Promise<TResult>
// Define a type for the function that generates arguments for the operation
type GetOperationArgsFn<TArgs extends object> = (path: string) => TArgs
// Define a type for the error toaster function
type ErrorToastFn = (message: string) => void

export function useFilesOperations() {
	const {t} = useTranslation()
	// if read-only, we return the operations without doing anything
	const isReadOnly = useIsFilesReadOnly()
	const utils = trpcReact.useUtils()
	const confirm = useConfirmation()

	const clipboardMode = useFilesStore((s) => s.clipboardMode)
	const clipboardItems = useFilesStore((s) => s.clipboardItems)
	const clearClipboard = useFilesStore((s) => s.clearClipboard)
	const selectedItems = useFilesStore((s) => s.selectedItems)
	const draggedItems = useFilesStore((s) => s.draggedItems)
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)
	const clearDraggedItems = useFilesStore((s) => s.clearDraggedItems)
	const addPendingPaths = useFilesStore((s) => s.addPendingPaths)
	const removePendingPaths = useFilesStore((s) => s.removePendingPaths)
	const addIncomingItems = useFilesStore((s) => s.addIncomingItems)
	const removeIncomingItems = useFilesStore((s) => s.removeIncomingItems)

	// Internal helper for batch operations (move, copy, restore) with collision handling
	// ----------------------------------------------------------
	const _executeBatchOperationWithCollisionHandling = async <TArgs extends object>({
		paths,
		operationAsyncFn,
		operationType,
		getOperationArgsFn,
		targetDirectory,
		onErrorToastFn,
		onSuccessAll,
		onItemError,
	}: {
		paths: string[]
		operationAsyncFn: OperationAsyncFn<TArgs>
		operationType: 'move' | 'copy' | 'restore'
		getOperationArgsFn: GetOperationArgsFn<TArgs>
		targetDirectory?: string
		onErrorToastFn: ErrorToastFn
		onSuccessAll?: () => void
		onItemError?: (path: string) => void
	}) => {
		// track if any operation ended with an unrecoverable error so we can avoid
		// firing the global success callback in that case.
		let encounteredError = false

		let globalCollisionDecision: 'replace' | 'keep-both' | 'skip' | null = null
		let applyDecisionToAllRemaining = false

		// a simple FIFO queue so that only one confirmation dialog is shown at a
		// time even though multiple collisions may be detected concurrently.
		const collisionQueue: {
			path: string
			resolve: (decision: 'replace' | 'keep-both' | 'skip') => void
		}[] = []
		let processingQueue = false

		const processNextInQueue = async () => {
			if (processingQueue || collisionQueue.length === 0) return
			processingQueue = true

			const {path, resolve} = collisionQueue.shift()!

			// if the user has already chosen to apply a decision to all remaining
			// collisions, we can resolve immediately without prompting.
			if (applyDecisionToAllRemaining && globalCollisionDecision) {
				resolve(globalCollisionDecision)
				processingQueue = false
				// process any queued items synchronously with the same decision
				processNextInQueue()
				return
			}

			const fromName = splitFileName(path.split('/').pop() || '').name
			const destinationName =
				operationType === 'restore'
					? t('files-collision.destination.original-location')
					: `"${splitFileName(targetDirectory?.split('/').pop() || '').name}"`

			let decision: 'replace' | 'keep-both' | 'skip' = 'skip'
			try {
				const result = await confirm({
					title: t('files-collision.title', {
						itemName: fromName,
						destinationName,
					}),
					message: t('files-collision.message'),
					actions: [
						{label: t('files-collision.action.keep-both'), value: 'keep-both', variant: 'primary'},
						{label: t('files-collision.action.replace'), value: 'replace', variant: 'default'},
						{label: t('files-collision.action.skip'), value: 'skip', variant: 'default'},
					],
					showApplyToAll: collisionQueue.length > 0, // i.e. when more collisions waiting
					icon: AiOutlineFileExclamation,
				})
				decision = result.actionValue as 'replace' | 'keep-both' | 'skip'
				if (result.applyToAll) {
					applyDecisionToAllRemaining = true
					globalCollisionDecision = decision
				}
			} catch {
				// dialog dismissed, default to skipping the file.
				decision = 'skip'
			}

			// resolve the promise for the item currently being processed.
			resolve(decision)
			processingQueue = false
			// process subsequent queued collisions (if any).
			processNextInQueue()
		}

		// helper to enqueue a collision resolution and wait for the user's choice.
		const getCollisionDecision = (path: string) =>
			new Promise<'replace' | 'keep-both' | 'skip'>((resolve) => {
				// if a global decision has been set, we honour it immediately.
				if (applyDecisionToAllRemaining && globalCollisionDecision) {
					resolve(globalCollisionDecision)
					return
				}

				collisionQueue.push({path, resolve})
				processNextInQueue()
			})

		// individual path handler
		const tasks = paths.map(async (path) => {
			const baseArgs = getOperationArgsFn(path) as Record<string, unknown>
			try {
				await operationAsyncFn({...baseArgs, collision: undefined} as any)
				return
			} catch (error: any) {
				// handle collision errors specially, everything else is a hard error.
				if (error?.message === '[destination-already-exists]') {
					const decision = await getCollisionDecision(path)
					if (decision === 'skip') {
						onItemError?.(path)
						return
					}
					try {
						await operationAsyncFn({...baseArgs, collision: decision} as any)
					} catch (err: any) {
						encounteredError = true
						onItemError?.(path)
						onErrorToastFn(err.message)
						console.error(`Failed ${operationType} ${path} after collision (${decision}):`, err)
					}
					return
				}

				// unrecoverable error
				encounteredError = true
				onItemError?.(path)
				onErrorToastFn(error.message)
				console.error(`Failed ${operationType} ${path}:`, error)
			}
		})

		await Promise.allSettled(tasks)

		if (!encounteredError) {
			onSuccessAll?.()
		}
	}

	// Basic file operations
	// --------------------

	// Rename item
	const renameItemMutation = trpcReact.files.rename.useMutation({
		onError: (error) => {
			toast.error(t('files-error.rename', {message: getFilesErrorMessage(error.message)}))
		},
		onSettled: () => {
			utils.files.list.invalidate()
			utils.files.recents.invalidate()
			utils.files.favorites.invalidate()
			utils.files.shares.invalidate()
			utils.files.search.invalidate()
		},
	}).mutateAsync

	const renameItem = async ({item, newName}: {item: FileSystemItem; newName: string}) => {
		if (isReadOnly) return
		const currentName = item.path.split('/').pop() || ''

		// do nothing if the name hasn't changed
		if (currentName === newName) {
			return
		}

		const renamedPath = `${item.path.substring(0, item.path.lastIndexOf('/') + 1)}${newName}`
		const renamedItem = {...item, name: newName, path: renamedPath}

		// Show renamed item immediately, hide old one
		addPendingPaths([item.path], 'removing')
		addIncomingItems([renamedItem])
		setSelectedItems([renamedItem])

		try {
			await renameItemMutation({path: item.path, newName})
		} catch {
			// Revert optimistic update on error (toast handled by mutation's onError)
			removePendingPaths([item.path])
			removeIncomingItems([renamedPath])
			setSelectedItems([item])
		}
	}

	// File movement operations
	// -----------------------

	// Move item mutation hook
	const moveItemMutation = trpcReact.files.move.useMutation({
		onSettled: () => {
			utils.files.list.invalidate()
			utils.files.recents.invalidate()
			utils.files.favorites.invalidate()
			utils.files.shares.invalidate()
			utils.files.search.invalidate()
		},
	}).mutateAsync

	const moveItems = async ({sourceItems, toDirectory}: {sourceItems: FileSystemItem[]; toDirectory: string}) => {
		if (isReadOnly) return
		const fromPaths = sourceItems.map((item) => item.path)
		addPendingPaths(fromPaths, 'removing')

		// Show items at the destination immediately
		const incoming = sourceItems.map((item) => ({
			...item,
			path: `${toDirectory}/${item.name}`,
		}))
		addIncomingItems(incoming)

		await _executeBatchOperationWithCollisionHandling({
			paths: fromPaths,
			operationAsyncFn: moveItemMutation,
			operationType: 'move',
			getOperationArgsFn: (path) => ({path, toDirectory}),
			targetDirectory: toDirectory,
			onErrorToastFn: (message) => toast.error(t('files-error.move', {message: getFilesErrorMessage(message)})),
			onSuccessAll: () => {},
			onItemError: (sourcePath) => {
				removePendingPaths([sourcePath])
				const name = sourcePath.split('/').pop() || ''
				removeIncomingItems([`${toDirectory}/${name}`])
			},
		})
	}

	const moveSelectedItems = async ({toDirectory}: {toDirectory: string}) => {
		if (isReadOnly) return
		const items = [...selectedItems]
		setSelectedItems([])
		await moveItems({sourceItems: items, toDirectory})
	}

	const moveDraggedItems = async ({toDirectory}: {toDirectory: string}) => {
		if (isReadOnly) return
		const items = [...draggedItems]
		clearDraggedItems()
		await moveItems({sourceItems: items, toDirectory})
	}

	// Copy item mutation hook
	const copyItemMutation = trpcReact.files.copy.useMutation({
		onSettled: () => {
			utils.files.list.invalidate()
			utils.files.recents.invalidate()
			utils.files.search.invalidate()
		},
	}).mutateAsync

	// Copy does not use optimistic incoming items because large copies show progress
	// via the operations island (WebSocket). Adding placeholders would conflict with
	// the island by showing the file as "already there" while progress is still updating.
	const copyItems = async ({fromPaths, toDirectory}: {fromPaths: FileSystemItem['path'][]; toDirectory: string}) => {
		if (isReadOnly) return
		await _executeBatchOperationWithCollisionHandling({
			paths: fromPaths,
			operationAsyncFn: copyItemMutation,
			operationType: 'copy',
			getOperationArgsFn: (path) => ({path, toDirectory}),
			targetDirectory: toDirectory,
			onErrorToastFn: (message) => toast.error(t('files-error.copy', {message: getFilesErrorMessage(message)})),
			onSuccessAll: () => {},
		})
	}

	// Paste (copy or move) items from clipboard
	const pasteItemsFromClipboard = async ({toDirectory}: {toDirectory: string}) => {
		if (isReadOnly) return
		if (clipboardMode === 'copy') {
			const paths = clipboardItems.map((item) => item.path)
			await copyItems({fromPaths: paths, toDirectory})
		} else if (clipboardMode === 'cut') {
			const items = [...clipboardItems]
			clearClipboard()
			await moveItems({sourceItems: items, toDirectory})
		}
	}

	// Compression operations
	// ---------------------

	// Extract archive (umbreld always extracts archive contents into a new folder named after the archive)
	const extract = trpcReact.files.unarchive.useMutation({
		onSuccess: async (_, {path}) => {
			const parentPath = path.substring(0, path.lastIndexOf('/'))
			await Promise.all([utils.files.list.invalidate({path: parentPath}), utils.files.search.invalidate()])
			useFilesStore.getState().removePendingPaths([path])
		},
		onError: (error) => {
			toast.error(t('files-error.extract', {message: getFilesErrorMessage(error.message)}))
		},
	}).mutateAsync

	const extractSelectedItems = () => {
		if (isReadOnly) return
		const paths = selectedItems.map((item) => item.path)
		addPendingPaths(paths, 'processing')
		for (const item of selectedItems) {
			extract({path: item.path}).catch(() => {
				removePendingPaths([item.path])
			})
		}
		setSelectedItems([])
	}

	// Archive
	const archive = trpcReact.files.archive.useMutation({
		onSuccess: async (_, {paths}) => {
			await Promise.all([
				// invalidate the parent directory of the item
				utils.files.list.invalidate({path: paths[0].split('/').slice(0, -1).join('/')}),
				// invalidate the recents list
				utils.files.recents.invalidate(),
				// invalidate the search list
				utils.files.search.invalidate(),
			])
			useFilesStore.getState().removePendingPaths(paths)
		},
		onError: (error, {paths}) => {
			useFilesStore.getState().removePendingPaths(paths)
			toast.error(t('files-error.compress', {message: getFilesErrorMessage(error.message)}))
		},
	}).mutateAsync

	const archiveSelectedItems = () => {
		if (isReadOnly) return
		const paths = selectedItems.map((item) => item.path)
		addPendingPaths(paths, 'processing')
		archive({paths}).catch(() => {})
		setSelectedItems([])
	}

	// Trash operations
	// ---------------

	// Trash item
	const trashItem = trpcReact.files.trash.useMutation({
		onMutate: async ({path}) => {
			if (path.startsWith(TRASH_PATH)) {
				throw new Error('ALREADY_IN_TRASH')
			}
		},
		onError: (error) => {
			if (error.message !== 'ALREADY_IN_TRASH') {
				toast.error(t('files-error.trash', {message: getFilesErrorMessage(error.message)}))
			}
		},
		onSettled: () => {
			utils.files.list.invalidate()
			utils.files.recents.invalidate()
			utils.files.favorites.invalidate()
			utils.files.shares.invalidate()
			utils.files.search.invalidate()
		},
	}).mutateAsync

	const trashSelectedItems = () => {
		if (isReadOnly) return
		const paths = selectedItems.map((item) => item.path)
		addPendingPaths(paths, 'removing')
		for (const item of selectedItems) {
			trashItem({path: item.path}).catch(() => {
				removePendingPaths([item.path])
			})
		}
		setSelectedItems([])
	}

	const trashDraggedItems = () => {
		if (isReadOnly) return
		const paths = draggedItems.map((item) => item.path)
		addPendingPaths(paths, 'removing')
		for (const item of draggedItems) {
			trashItem({path: item.path}).catch(() => {
				removePendingPaths([item.path])
			})
		}
		clearDraggedItems()
	}

	// Restore from trash
	const restoreFromTrash = trpcReact.files.restore.useMutation({
		onSettled: () => {
			utils.files.list.invalidate()
			utils.files.recents.invalidate()
			utils.files.search.invalidate()
		},
	}).mutateAsync

	// Updated batch restore function
	const restoreItems = async ({paths}: {paths: string[]}) => {
		if (isReadOnly) return
		addPendingPaths(paths, 'removing')
		await _executeBatchOperationWithCollisionHandling({
			paths,
			operationAsyncFn: restoreFromTrash,
			operationType: 'restore',
			getOperationArgsFn: (path) => ({path}),
			onErrorToastFn: (message) => toast.error(t('files-error.restore', {message: getFilesErrorMessage(message)})),
			onSuccessAll: () => {},
			onItemError: (path) => removePendingPaths([path]),
		})
	}

	const restoreSelectedItems = () => {
		if (isReadOnly) return
		restoreItems({paths: selectedItems.map((item) => item.path)})
		setSelectedItems([])
	}

	// (Permanently) delete item
	// This is only possible in /Trash, /External, and /Network
	const deleteItem = trpcReact.files.delete.useMutation({
		onSuccess: (_data, {path}) => {
			// If we're permanently deleting from Trash, we can just invalidate the Trash listing.
			if (path.startsWith(TRASH_PATH)) {
				utils.files.list.invalidate({path: TRASH_PATH})
			} else {
				// Otherwise invalidate the generic list
				utils.files.list.invalidate()
				// Invalidate favorites since they can include External/Network items
				utils.files.favorites.invalidate()
				// Invalidate shares since they can include External items
				utils.files.shares.invalidate()
			}
		},
		onError: (error) => {
			toast.error(t('files-error.delete', {message: getFilesErrorMessage(error.message)}))
		},
	}).mutateAsync

	const deleteSelectedItems = () => {
		if (isReadOnly) return
		const paths = selectedItems.map((item) => item.path)
		addPendingPaths(paths, 'removing')
		for (const item of selectedItems) {
			deleteItem({path: item.path}).catch(() => {
				removePendingPaths([item.path])
			})
		}
		setSelectedItems([])
	}

	// Empty trash
	const emptyTrash = trpcReact.files.emptyTrash.useMutation({
		onError: (error) => {
			toast.error(t('files-error.empty-trash', {message: getFilesErrorMessage(error.message)}))
		},
		onSettled: () => {
			// invalidate the trash directory
			utils.files.list.invalidate({path: TRASH_PATH})
		},
	}).mutateAsync

	// Download operations
	// ------------------

	// Download selected items
	const downloadSelectedItems = () => {
		// For multiple items, construct URL with multiple path parameters
		const paths = selectedItems.map((item) => `path=${encodeURIComponent(item.path)}`).join('&')
		const url = `/api/files/download?${paths}`
		// create a temporary anchor element to download the files
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.setAttribute('download', '')
		// add the anchor to the body
		document.body.appendChild(anchor)
		// click the anchor to download the files
		anchor.click()
		// remove the anchor from the body
		document.body.removeChild(anchor)
	}

	// Some flows need to decide UI state before starting any long-running copy.
	// e.g., in Rewind feature, we want to:
	//  - Prompt for name collisions BEFORE showing a progress modal
	//  - Allow the user to skip all collisions and abort the entire operation cleanly
	// We fetch the destination listing once, detect per-item collisions, and prompt the
	// user. We then build and return a list of work items that
	// encode the chosen collision strategies per item. If the returned list is empty, the
	// caller should abort and not show any progress UI.
	type CopyWorkItem = {path: string; toDirectory: string; collision: 'error' | 'replace' | 'keep-both'}

	const resolveCopyCollisionsOrAbort = async ({
		fromPaths,
		toDirectory,
	}: {
		fromPaths: string[]
		toDirectory: string
	}): Promise<CopyWorkItem[]> => {
		if (isReadOnly) return []
		// Fetch destination once
		const listing = await utils.files.list.fetch({path: toDirectory, limit: 10000})
		const existing = new Set(listing.files.map((f) => f.name))

		const collisionPaths = fromPaths.filter((p) => existing.has(p.split('/').pop() || ''))
		let applyToAll = false
		let globalDecision: 'replace' | 'keep-both' | 'skip' | null = null

		const workItems: CopyWorkItem[] = []
		for (const path of fromPaths) {
			const base = path.split('/').pop() || ''
			const isCollision = existing.has(base)
			if (!isCollision) {
				workItems.push({path, toDirectory, collision: 'error'})
				continue
			}

			let decision: 'replace' | 'keep-both' | 'skip' = 'skip'
			if (applyToAll && globalDecision) {
				decision = globalDecision
			} else {
				try {
					const result = await confirm({
						title: t('files-collision.title', {
							itemName: base,
							destinationName: `"${toDirectory.split('/').pop() || ''}"`,
						}),
						message: t('files-collision.message'),
						actions: [
							{label: t('files-collision.action.keep-both'), value: 'keep-both', variant: 'primary'},
							{label: t('files-collision.action.replace'), value: 'replace', variant: 'default'},
							{label: t('files-collision.action.skip'), value: 'skip', variant: 'default'},
						],
						showApplyToAll: collisionPaths.length > 1,
						icon: AiOutlineFileExclamation,
					})
					decision = result.actionValue as 'replace' | 'keep-both' | 'skip'
					if (result.applyToAll) {
						applyToAll = true
						globalDecision = decision
					}
				} catch {
					decision = 'skip'
				}
			}

			if (decision !== 'skip') workItems.push({path, toDirectory, collision: decision})
		}

		return workItems
	}

	const executeCopyWorkItems = async ({workItems}: {workItems: CopyWorkItem[]}) => {
		if (isReadOnly) return
		for (const item of workItems) {
			await copyItemMutation({path: item.path, toDirectory: item.toDirectory, collision: item.collision})
		}
	}

	return {
		// Basic operations
		renameItem,
		// Movement operations
		copyItems,
		moveItems,
		moveDraggedItems,
		moveSelectedItems,
		pasteItemsFromClipboard,
		// Compression operations
		extractSelectedItems,
		archiveSelectedItems,
		// Trash operations
		trashDraggedItems,
		trashSelectedItems,
		restoreFromTrash,
		restoreSelectedItems,
		deleteSelectedItems,
		emptyTrash,
		// Download operations
		downloadSelectedItems,
		// Copy planning helpers for flows that must resolve collisions before starting (e.g. Rewind feature)
		resolveCopyCollisionsOrAbort,
		executeCopyWorkItems,
	}
}
