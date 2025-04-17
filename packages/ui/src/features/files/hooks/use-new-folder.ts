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
		onMutate: ({path}: {path: FileSystemItem['path']}) => {
			if (listing?.items) {
				// Extract name from path
				const name = path.split('/').pop() || ''
				// Best-effort check for duplicate name
				checkForDuplicateName(name, listing.items)
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
			trpc.files.list.invalidate()
		},
	})

	// NOTE: We can't reliably calculate the "next available name" (e.g., "Folder (2)")
	// with infinite loading, as we don't have the full list of existing names.
	// So, we always start with the base name (e.g., "Folder").
	const startNewFolder = () => {
		const name = t('files-folder')
		const timeStamp = new Date().getTime()
		const newFolder = {
			name,
			path: currentPath + '/' + name,
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
		isLoading: createFolder.isLoading,
	}
}

// This is a best-effort check as it only compares against the currently loaded items.
// umbreld still returns true if EEXIST, but doesn't create the folder.
// So even if we don't throw an error here, umbreld will still handle the duplicate name.
// But when we do throw an error, the user will see a toast
function checkForDuplicateName(name: string, existingItems: FileSystemItem[]) {
	const existingNames = new Set(existingItems.map((item) => item.name))
	if (existingNames.has(name)) {
		throw new Error('A folder with this name already exists')
	}
}
