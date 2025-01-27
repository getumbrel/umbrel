import {toast} from 'sonner'

import {TRASH_PATH} from '@/features/files/constants'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {isOperationAllowed} from '@/features/files/utils/allowed-filesystem-operation'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useFilesOperations() {
	const utils = trpcReact.useContext()

	const clipboardMode = useFilesStore((s) => s.clipboardMode)
	const clipboardItems = useFilesStore((s) => s.clipboardItems)
	const clearClipboard = useFilesStore((s) => s.clearClipboard)
	const selectedItems = useFilesStore((s) => s.selectedItems)
	const draggedItems = useFilesStore((s) => s.draggedItems)
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)
	const clearDraggedItems = useFilesStore((s) => s.clearDraggedItems)

	// Basic file operations
	// --------------------

	// Rename item
	const renameItemMutation = trpcReact.files.rename.useMutation({
		onSuccess: async () => {
			await utils.files.list.invalidate()
			await utils.files.recents.invalidate()
		},
		onError: (error) => {
			toast.error(t('files-error.rename', {message: error.message}))
		},
	}).mutateAsync

	const renameItem = async ({item, toName}: {item: FileSystemItem; toName: string}) => {
		const currentName = item.path.split('/').pop() || ''

		// do nothing if the name hasn't changed
		if (currentName === toName) {
			return
		}

		// Check if the operation is allowed
		if (!isOperationAllowed(item.path, 'rename')) {
			throw new Error('Cannot rename this item')
		}

		// Wait for the rename to complete successfully
		await renameItemMutation({path: item.path, toName})

		// Set the newly renamed item as selected
		setSelectedItems([
			{
				...item,
				name: toName,
				path: `${item.path.split('/').slice(0, -1).join('/')}/${toName}`,
			},
		])
	}

	// File movement operations
	// -----------------------

	// Move item
	const moveItem = trpcReact.files.move.useMutation({
		onMutate: async ({path, toDirectory}) => {
			const currentDirectory = path.split('/').slice(0, -1).join('/')
			if (currentDirectory === toDirectory) {
				throw new Error('SAME_PATH')
			}
		},
		onSuccess: async (_, {path, toDirectory}) => {
			// invalidate the path where the item was moved to
			await utils.files.list.invalidate({path: toDirectory})
			// invalidate the parent directory of the item
			await utils.files.list.invalidate({path: path.split('/').slice(0, -1).join('/')})
			// invalidate the recents list
			await utils.files.recents.invalidate()
		},
		onError: (error) => {
			if (error.message !== 'SAME_PATH') {
				toast.error(t('files-error.move', {message: error.message}))
			}
		},
	}).mutateAsync
	// Move selected items
	const moveSelectedItems = ({toDirectory}: {toDirectory: string}) => {
		for (const item of selectedItems) {
			if (isOperationAllowed(item.path, 'move') && isOperationAllowed(toDirectory, 'paste')) {
				moveItem({path: item.path, toDirectory})
			}
		}
		setSelectedItems([])
	}

	// Move dragged items
	const moveDraggedItems = ({toDirectory}: {toDirectory: string}) => {
		for (const item of draggedItems) {
			if (isOperationAllowed(item.path, 'move') && isOperationAllowed(toDirectory, 'paste')) {
				moveItem({path: item.path, toDirectory})
			}
		}
		clearDraggedItems()
	}

	// Copy item
	const copyItem = trpcReact.files.copy.useMutation({
		onSuccess: async (_, {path, toDirectory}) => {
			// invalidate the path where the item was copied to
			await utils.files.list.invalidate({path: toDirectory})
			// invalidate the parent directory of the item
			await utils.files.list.invalidate({path: path.split('/').slice(0, -1).join('/')})
			// invalidate the recents list
			await utils.files.recents.invalidate()
		},
		onError: (error) => {
			toast.error(t('files-error.copy', {message: error.message}))
		},
	}).mutateAsync

	// Paste (copy or move) items from clipboard
	const pasteItemsFromClipboard = ({toDirectory}: {toDirectory: string}) => {
		for (const item of clipboardItems) {
			if (isOperationAllowed(toDirectory, 'paste')) {
				if (clipboardMode === 'copy') {
					copyItem({path: item.path, toDirectory: toDirectory})
				} else if (clipboardMode === 'cut') {
					moveItem({path: item.path, toDirectory: toDirectory})
				}
			}
		}
		clearClipboard()
	}

	// Compression operations
	// ---------------------

	// Extract archive
	const extract = trpcReact.files.extract.useMutation({
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
		onSuccess: async (_, {path}) => {
			// invalidate the parent directory of the item
			await utils.files.list.invalidate({path: path.split('/').slice(0, -1).join('/')})
			// invalidate the recents list
			await utils.files.recents.invalidate()
			// invalidate the trash directory
			await utils.files.list.invalidate({path: TRASH_PATH})
		},
		onError: (error) => {
			if (error.message !== 'ALREADY_IN_TRASH') {
				toast.error(t('files-error.trash', {message: error.message}))
			}
		},
	}).mutateAsync

	const trashSelectedItems = () => {
		for (const item of selectedItems) {
			if (isOperationAllowed(item.path, 'trash')) {
				trashItem({path: item.path})
			}
		}
		setSelectedItems([])
	}

	const trashDraggedItems = () => {
		for (const item of draggedItems) {
			if (isOperationAllowed(item.path, 'trash')) {
				trashItem({path: item.path})
			}
		}
		clearDraggedItems()
	}

	// Restore from trash
	const restoreFromTrash = trpcReact.files.restore.useMutation({
		onSuccess: async () => {
			await utils.files.list.invalidate()
		},
		onError: (error) => {
			toast.error(t('files-error.restore', {message: error.message}))
		},
	}).mutateAsync

	const restoreSelectedItems = () => {
		for (const item of selectedItems) {
			restoreFromTrash({path: item.path})
		}
		setSelectedItems([])
	}

	// (Permanently) delete item
	const deleteItem = trpcReact.files.delete.useMutation({
		onSuccess: async () => {
			// invalidate the trash directory
			await utils.files.list.invalidate({path: TRASH_PATH})
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
		window.open(`/api/files/download?${paths}`, '_blank')
	}

	return {
		// Basic operations
		renameItem,
		// Movement operations
		moveDraggedItems,
		moveSelectedItems,
		pasteItemsFromClipboard,
		// Compression operations
		extractSelectedItems,
		archiveSelectedItems,
		// Trash operations
		trashDraggedItems,
		trashSelectedItems,
		restoreSelectedItems,
		deleteSelectedItems,
		emptyTrash,
		// Download operations
		downloadSelectedItems,
	}
}
