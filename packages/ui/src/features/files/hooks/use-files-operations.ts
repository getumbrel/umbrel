import {AiOutlineFileExclamation} from 'react-icons/ai'
import {toast} from 'sonner'

import {TRASH_PATH} from '@/features/files/constants'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {useConfirmation} from '@/providers/confirmation'
import type {ConfirmationResult} from '@/providers/confirmation'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

// Define a type for the operation function signature used by the helper
type OperationAsyncFn<TArgs extends object, TResult = any> = (args: TArgs) => Promise<TResult>
// Define a type for the function that generates arguments for the operation
type GetOperationArgsFn<TArgs extends object> = (path: string) => TArgs
// Define a type for the error toaster function
type ErrorToastFn = (message: string) => void

export function useFilesOperations() {
	const utils = trpcReact.useUtils()
	const confirm = useConfirmation()

	const clipboardMode = useFilesStore((s) => s.clipboardMode)
	const clipboardItems = useFilesStore((s) => s.clipboardItems)
	const clearClipboard = useFilesStore((s) => s.clearClipboard)
	const selectedItems = useFilesStore((s) => s.selectedItems)
	const draggedItems = useFilesStore((s) => s.draggedItems)
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)
	const clearDraggedItems = useFilesStore((s) => s.clearDraggedItems)

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
	}: {
		paths: string[]
		operationAsyncFn: OperationAsyncFn<TArgs>
		operationType: 'move' | 'copy' | 'restore'
		getOperationArgsFn: GetOperationArgsFn<TArgs>
		targetDirectory?: string
		onErrorToastFn: ErrorToastFn
		onSuccessAll?: () => void
	}) => {
		let allSucceededWithoutCollision = true
		const initialOperationPromises = paths.map(async (path) => {
			try {
				const args = getOperationArgsFn(path)
				await operationAsyncFn({...args, collision: undefined})
				return {status: 'success', itemPath: path}
			} catch (error: any) {
				if (error.message === '[destination-already-exists]') {
					allSucceededWithoutCollision = false
					return {status: 'collision', itemPath: path, error}
				}
				allSucceededWithoutCollision = false
				onErrorToastFn(error.message)
				console.error(`Failed initial ${operationType} ${path}:`, error)
				return {status: 'error', itemPath: path, error}
			}
		})

		const initialResults = await Promise.allSettled(initialOperationPromises)

		const collisionItemsPaths = initialResults.reduce<string[]>((acc, result) => {
			if (result.status === 'fulfilled' && result.value.status === 'collision') {
				acc.push(result.value.itemPath)
			}
			return acc
		}, [])

		if (collisionItemsPaths.length > 0) {
			const remainingCollisionPaths = [...collisionItemsPaths]
			let applyDecisionToAll: 'replace' | 'keep-both' | 'skip' | null = null
			let applyToAllChecked = false

			while (remainingCollisionPaths.length > 0) {
				const currentPath = remainingCollisionPaths[0]
				const fromName = splitFileName(currentPath.split('/').pop() || '').name
				const destinationName =
					operationType === 'restore'
						? t('files-collision.destination.original-location')
						: `"${splitFileName(targetDirectory?.split('/').pop() || '').name}"`

				let collisionChoice: ConfirmationResult['actionValue'] = 'skip'

				if (!applyToAllChecked) {
					try {
						const result = await confirm({
							title: t('files-collision.title', {itemName: fromName, destinationName: destinationName}),
							message: t('files-collision.message'),
							actions: [
								{label: t('files-collision.action.keep-both'), value: 'keep-both', variant: 'primary'},
								{label: t('files-collision.action.replace'), value: 'replace', variant: 'default'},
								{label: t('files-collision.action.skip'), value: 'skip', variant: 'default'},
							],
							showApplyToAll: remainingCollisionPaths.length > 1,
							icon: AiOutlineFileExclamation,
						})

						collisionChoice = result.actionValue
						applyToAllChecked = result.applyToAll
						if (applyToAllChecked) {
							applyDecisionToAll = collisionChoice as 'replace' | 'keep-both' | 'skip'
						}
					} catch (error) {
						// Collision confirmation dismissed by user
						allSucceededWithoutCollision = false
						applyDecisionToAll = 'skip'
						applyToAllChecked = true
						collisionChoice = 'skip'
					}
				} else {
					collisionChoice = applyDecisionToAll!
				}

				const pathsToProcess = applyToAllChecked ? [...remainingCollisionPaths] : [currentPath]
				const mutationPromises = []

				for (const path of pathsToProcess) {
					let mutationFn: typeof moveItemMutation | typeof copyItemMutation | typeof restoreFromTrash
					let mutationArgs: any

					if (collisionChoice !== 'skip') {
						const collisionStrategy = collisionChoice as 'replace' | 'keep-both'
						if (operationType === 'move' && targetDirectory) {
							mutationFn = moveItemMutation
							mutationArgs = {path, toDirectory: targetDirectory, collision: collisionStrategy}
						} else if (operationType === 'copy' && targetDirectory) {
							mutationFn = copyItemMutation
							mutationArgs = {path, toDirectory: targetDirectory, collision: collisionStrategy}
						} else if (operationType === 'restore') {
							mutationFn = restoreFromTrash
							mutationArgs = {path, collision: collisionStrategy}
						} else {
							console.error(`Invalid state for collision resolution: op=${operationType}, target=${targetDirectory}`)
							continue
						}
						mutationPromises.push(
							mutationFn(mutationArgs).catch((err) => {
								allSucceededWithoutCollision = false
								onErrorToastFn(`Failed during ${collisionChoice}: ${err.message}`)
								console.error(`Failed ${operationType} ${path} with collision ${collisionChoice}:`, err)
							}),
						)
					}
				}

				await Promise.allSettled(mutationPromises)

				if (applyToAllChecked) {
					remainingCollisionPaths.length = 0
				} else {
					remainingCollisionPaths.shift()
				}
			}
		} else if (allSucceededWithoutCollision) {
			onSuccessAll?.()
		}
	}

	// Basic file operations
	// --------------------

	// Rename item
	const renameItemMutation = trpcReact.files.rename.useMutation({
		onError: (error) => {
			toast.error(t('files-error.rename', {message: error.message}))
		},
		onSettled: async () => {
			await utils.files.list.invalidate()
			await utils.files.recents.invalidate()
			await utils.files.favorites.invalidate()
			await utils.files.shares.invalidate()
		},
	}).mutateAsync

	const renameItem = async ({item, newName}: {item: FileSystemItem; newName: string}) => {
		const currentName = item.path.split('/').pop() || ''

		// do nothing if the name hasn't changed
		if (currentName === newName) {
			return
		}

		// Wait for the rename mutation to complete and trigger list invalidation.
		await renameItemMutation({path: item.path, newName})

		// After a successful rename, update the selection so the *new* item remains selected.
		const renamedPath = `${item.path.substring(0, item.path.lastIndexOf('/') + 1)}${newName}`

		setSelectedItems([{...item, name: newName, path: renamedPath}])
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
		},
	}).mutateAsync

	const moveItems = async ({fromPaths, toDirectory}: {fromPaths: FileSystemItem['path'][]; toDirectory: string}) => {
		await _executeBatchOperationWithCollisionHandling({
			paths: fromPaths,
			operationAsyncFn: moveItemMutation,
			operationType: 'move',
			getOperationArgsFn: (path) => ({path, toDirectory}),
			targetDirectory: toDirectory,
			onErrorToastFn: (message) => toast.error(t('files-error.move', {message})),
			onSuccessAll: () => {},
		})
	}

	const moveSelectedItems = async ({toDirectory}: {toDirectory: string}) => {
		await moveItems({fromPaths: selectedItems.map((item) => item.path), toDirectory})
		setSelectedItems([])
	}

	const moveDraggedItems = async ({toDirectory}: {toDirectory: string}) => {
		await moveItems({fromPaths: draggedItems.map((item) => item.path), toDirectory})
		clearDraggedItems()
	}

	// Copy item mutation hook
	const copyItemMutation = trpcReact.files.copy.useMutation({
		onSettled: () => {
			utils.files.list.invalidate()
			utils.files.recents.invalidate()
		},
	}).mutateAsync

	const copyItems = async ({fromPaths, toDirectory}: {fromPaths: FileSystemItem['path'][]; toDirectory: string}) => {
		await _executeBatchOperationWithCollisionHandling({
			paths: fromPaths,
			operationAsyncFn: copyItemMutation,
			operationType: 'copy',
			getOperationArgsFn: (path) => ({path, toDirectory}),
			targetDirectory: toDirectory,
			onErrorToastFn: (message) => toast.error(t('files-error.copy', {message})),
			onSuccessAll: () => {},
		})
	}

	// Paste (copy or move) items from clipboard
	const pasteItemsFromClipboard = async ({toDirectory}: {toDirectory: string}) => {
		const paths = clipboardItems.map((item) => item.path)
		if (clipboardMode === 'copy') {
			await copyItems({fromPaths: paths, toDirectory})
		} else if (clipboardMode === 'cut') {
			await moveItems({fromPaths: paths, toDirectory})
			// only clear the clipboard on move, not copy
			clearClipboard()
		}
	}

	// Compression operations
	// ---------------------

	// Extract archive (umbreld always extracts archive contents into a new folder named after the archive)
	const extract = trpcReact.files.unarchive.useMutation({
		onSuccess: async () => {
			await utils.files.list.invalidate()
		},
		onError: (error) => {
			toast.error(t('files-error.extract', {message: error.message}))
		},
	}).mutateAsync

	const extractSelectedItems = () => {
		for (const item of selectedItems) {
			extract({path: item.path})
		}
		setSelectedItems([])
	}

	// Archive
	const archive = trpcReact.files.archive.useMutation({
		onSuccess: async (_, {paths}) => {
			// invalidate the parent directory of the item
			await utils.files.list.invalidate({path: paths[0].split('/').slice(0, -1).join('/')})
			// invalidate the recents list
			await utils.files.recents.invalidate()
		},
		onError: (error) => {
			toast.error(t('files-error.compress', {message: error.message}))
		},
	}).mutateAsync

	const archiveSelectedItems = () => {
		const paths = selectedItems.map((item) => item.path)
		archive({paths})
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
				toast.error(t('files-error.trash', {message: error.message}))
			}
		},
		onSettled: async () => {
			await utils.files.list.invalidate()
			await utils.files.recents.invalidate()
			await utils.files.favorites.invalidate()
			await utils.files.shares.invalidate()
		},
	}).mutateAsync

	const trashSelectedItems = () => {
		for (const item of selectedItems) {
			trashItem({path: item.path})
		}
		setSelectedItems([])
	}

	const trashDraggedItems = () => {
		for (const item of draggedItems) {
			trashItem({path: item.path})
		}
		clearDraggedItems()
	}

	// Restore from trash
	const restoreFromTrash = trpcReact.files.restore.useMutation({
		onSettled: () => {
			utils.files.list.invalidate()
			utils.files.recents.invalidate()
		},
	}).mutateAsync

	// Updated batch restore function
	const restoreItems = async ({paths}: {paths: string[]}) => {
		await _executeBatchOperationWithCollisionHandling({
			paths,
			operationAsyncFn: restoreFromTrash,
			operationType: 'restore',
			getOperationArgsFn: (path) => ({path}),
			onErrorToastFn: (message) => toast.error(t('files-error.restore', {message})),
			onSuccessAll: () => {},
		})
	}

	const restoreSelectedItems = () => {
		restoreItems({paths: selectedItems.map((item) => item.path)})
		setSelectedItems([])
	}

	// (Permanently) delete item
	const deleteItem = trpcReact.files.delete.useMutation({
		onSuccess: async (_data, {path}) => {
			// If the deleted item's path starts with "/External/" we invalidate
			// the generic list considering the item was on external storage and,
			// not in the trash, otherwise we only invalidate the trash list
			if (path.startsWith('/External/')) {
				await utils.files.list.invalidate()
			} else {
				await utils.files.list.invalidate({path: TRASH_PATH})
			}
		},
		onError: (error) => {
			toast.error(t('files-error.delete', {message: error.message}))
		},
	}).mutateAsync

	const deleteSelectedItems = () => {
		for (const item of selectedItems) {
			deleteItem({path: item.path})
		}
		setSelectedItems([])
	}

	// Empty trash
	const emptyTrash = trpcReact.files.emptyTrash.useMutation({
		onSuccess: async () => {
			// invalidate the trash directory
			await utils.files.list.invalidate({path: TRASH_PATH})
		},
		onError: (error) => {
			toast.error(t('files-error.empty-trash', {message: error.message}))
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
	}
}
