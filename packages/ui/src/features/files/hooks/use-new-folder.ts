import {useEffect, useRef} from 'react'
import {toast} from 'sonner'

import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useNewFolder() {
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

	const createFolder = trpcReact.files.createDirectory.useMutation({
		onMutate: ({path}: {path: FileSystemItem['path']}) => {
			if (listingRef.current?.items) {
				// Extract name from path
				const name = path.split('/').pop() || ''
				// Best-effort check for duplicate name
				if (!isNameAvailable(name, listingRef.current.items)) {
					throw new Error('A folder with this name already exists')
				}
			}
		},
		onSuccess: (_, {path}: {path: FileSystemItem['path']}) => {
			setNewFolder(null)

			// Extract name from path
			const name = path.split('/').pop() || ''

			// Set the new folder as selected
			setSelectedItems([
				{
					name,
					path,
					type: 'directory',
					size: 0,
					modified: new Date().getTime(),
					operations: [],
				},
			])
		},
		onError: (error) => {
			toast.error(t('files-error.create-folder', {message: error.message}))
		},
		onSettled: () => {
			utils.files.list.invalidate()
		},
	})

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
		createFolder,
		startNewFolder,
		cancelNewFolder,
		isLoading: createFolder.isPending,
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
