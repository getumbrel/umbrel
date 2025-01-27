import {toast} from 'sonner'

import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useNewFolder() {
	const trpc = trpcReact.useContext()
	const {currentPath} = useNavigate()
	const {listing} = useListDirectory(currentPath)
	const setNewFolder = useFilesStore((s) => s.setNewFolder)
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)

	const createFolder = trpcReact.files.createDirectory.useMutation({
		onMutate: ({name}: {name: FileSystemItem['name']}) => {
			if (listing?.items) {
				checkForDuplicateName(name, listing.items)
			}
		},
		onSuccess: (_, {path, name}: {path: FileSystemItem['path']; name: FileSystemItem['name']}) => {
			setNewFolder(null)

			// Set the new folder as selected
			setSelectedItems([
				{
					name,
					path: `${path}/${name}`,
					type: 'directory',
					ops: 0,
					size: 0,
					created: new Date().toISOString(),
					modified: new Date().toISOString(),
				},
			])
		},
		onError: (error) => {
			toast.error(t('files-error.create-folder', {message: error.message}))
		},
		onSettled: () => {
			trpc.files.list.invalidate()
		},
	})

	// TODO: remove or redo this since we can't check for duplicate names across all pages
	const getNextAvailableName = () => {
		const existingNames = new Set(listing?.items.map((item) => item.name) ?? [])
		const baseName = t('files-folder')

		if (!existingNames.has(baseName)) {
			return baseName
		}

		let index = 2
		while (existingNames.has(`${baseName} (${index})`)) {
			index++
		}
		return `${baseName} (${index})`
	}

	const startNewFolder = () => {
		const name = getNextAvailableName()
		const timeStamp = new Date().toISOString()
		const newFolder = {
			name,
			path: currentPath + '/' + name,
			type: 'directory',
			size: 0,
			ops: 0,
			created: timeStamp,
			modified: timeStamp,
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
		isLoading: createFolder.isLoading,
	}
}

// We throw an error if the name is already taken, but don't need to do any cleanup.
// umbreld handles the cleanup of the folder.
// We need to throw an error here because umbreld silently fails on EEXIST error.
function checkForDuplicateName(name: string, existingItems: FileSystemItem[]) {
	const existingNames = new Set(existingItems.map((item) => item.name))
	if (existingNames.has(name)) {
		throw new Error('A folder with this name already exists')
	}
}
