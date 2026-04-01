import {useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {trpcReact} from '@/trpc/trpc'

export function useNewFolder() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const {currentPath} = useNavigate()
	const {listing} = useListDirectory(currentPath)
	const setNewFolder = useFilesStore((s) => s.setNewFolder)
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)

	// These refs maintain a stable reference to the latest values of currentPath and listing.
	// This ensures that when startNewFolder is called, it will always have access to the
	// most up-to-date values for accurate folder creation and name validation.
	const currentPathRef = useRef(currentPath)
	const listingRef = useRef(listing)

	// keep the ref updated with the latest currentPath
	useEffect(() => {
		currentPathRef.current = currentPath
	}, [currentPath])

	// keep the ref updated with the latest listing
	useEffect(() => {
		listingRef.current = listing
	}, [listing])

	const addIncomingItems = useFilesStore((s) => s.addIncomingItems)
	const removeIncomingItems = useFilesStore((s) => s.removeIncomingItems)

	const createFolderMutation = trpcReact.files.createDirectory.useMutation({
		onError: (error, {path}) => {
			removeIncomingItems([path])
			toast.error(t('files-error.create-folder', {message: getFilesErrorMessage(error.message)}))
		},
		onSettled: () => {
			utils.files.list.invalidate()
		},
	})

	// Commits the folder name synchronously: removes the top-pinned placeholder
	// and inserts a sorted incoming item, then fires the mutation.
	const commitNewFolder = (fullPath: string) => {
		const name = fullPath.split('/').pop() || ''

		if (listingRef.current?.items) {
			if (!isNameAvailable(name, listingRef.current.items)) {
				toast.error(t('files-error.folder-already-exists'))
				return
			}
		}

		const folder: FileSystemItem = {
			name,
			path: fullPath,
			type: 'directory',
			size: 0,
			modified: new Date().getTime(),
			operations: [],
		}

		// Move from top-pinned placeholder to sorted incoming item
		addIncomingItems([folder])
		setNewFolder(null)
		setSelectedItems([folder])

		createFolderMutation.mutate({path: fullPath})
	}

	// NOTE: We can't reliably calculate the "next available name"
	// with infinite loading, as we don't have the full list of existing names.
	// So, we just check against the currently loaded items and start with the base name (e.g., "Folder").
	// and keep incrementing the index until we find an available name.
	// (e.g., "Folder (2)", "Folder (3)", etc.)
	const startNewFolder = async () => {
		let name = t('files-folder')
		if (listingRef.current?.items) {
			// Check if the base name already exists
			if (!isNameAvailable(name, listingRef.current.items)) {
				// If it does, find the next available name
				let index = 2
				while (!isNameAvailable(`${name} (${index})`, listingRef.current.items)) {
					index++
				}
				name = `${name} (${index})`
			}
		}

		const timeStamp = new Date().getTime()
		const newFolder = {
			name,
			path: currentPathRef.current + '/' + name,
			type: 'directory',
			size: 0,
			modified: timeStamp,
			operations: [],
			isNew: true,
		}
		setNewFolder(newFolder)
		setSelectedItems([newFolder])
	}

	const cancelNewFolder = () => {
		setNewFolder(null)
		setSelectedItems([])
	}

	return {
		commitNewFolder,
		startNewFolder,
		cancelNewFolder,
		isLoading: createFolderMutation.isPending,
	}
}

// This is a best-effort check as it only compares against the currently loaded items.
// umbreld still returns true if EEXIST, but doesn't create the folder.
// So even if we don't throw an error here, umbreld will still handle the duplicate name.
// But when we do throw an error, the user will see a toast
function isNameAvailable(name: string, existingItems: FileSystemItem[]) {
	const existingNames = new Set(existingItems.map((item) => item.name))
	return !existingNames.has(name)
}
