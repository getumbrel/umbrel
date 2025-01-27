import {useEffect, useRef, useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/shadcn-lib/utils'

interface EditableNameProps {
	item: FileSystemItem
	view: 'icons' | 'list'
	onFinish: () => void
}

export const EditableName = ({item, view, onFinish}: EditableNameProps) => {
	const {name: initialName, path} = item

	const inputRef = useRef<HTMLInputElement>(null)
	const [name, setName] = useState(initialName)
	const isTouchDevice = useIsTouchDevice()

	const {renameItem} = useFilesOperations()
	const {cancelNewFolder, createFolder} = useNewFolder()

	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	const isCreatingNewFolder = 'isNew' in item && item.isNew

	// Focus the input after the component mounts
	useEffect(() => {
		const timer = setTimeout(() => {
			if (inputRef.current) {
				inputRef.current.focus()
				// if creating a new folder, select all text
				if (isCreatingNewFolder) {
					return inputRef.current.select()
				}

				// if renaming an item, select its name minus the extension (only for files, not directories)
				if (item.type !== 'directory') {
					const {name} = splitFileName(item.name)
					return inputRef.current.setSelectionRange(0, name.length)
				}

				// select the entire name for directories
				return inputRef.current.select()
			}
		}, 100)
		return () => clearTimeout(timer)
	}, [])

	const handleSubmit = (submittedName: string) => {
		const trimmedName = submittedName.trim()
		if (isCreatingNewFolder) {
			createFolder.mutate({path: path.split('/').slice(0, -1).join('/'), name: trimmedName})
		} else {
			// check if the user is changing the extension of a file
			if (item.type !== 'directory') {
				const {extension: currentNameExtension} = splitFileName(initialName)
				const {extension: toNameExtension} = splitFileName(trimmedName)

				// if the extension is changing, show the extension change confirmation dialog
				// and let it handle the renaming
				if (currentNameExtension !== toNameExtension) {
					return navigate({
						search: addLinkSearchParams({
							dialog: 'files-extension-change-confirmation',
							currentName: item.name,
							currentPath: item.path,
							renameTo: trimmedName,
						}),
					})
				}
			}

			renameItem({item, toName: trimmedName})
		}
		onFinish()
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		// submit the name on Enter
		if (e.key === 'Enter') {
			e.preventDefault()
			e.stopPropagation()
			return handleSubmit(name)
		}

		// cancel new folder and rename on Escape
		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()

			// cancel new folder
			if ('isNew' in item && item.isNew) {
				return cancelNewFolder()
			}

			// cancel rename
			return handleSubmit(initialName)
		}
	}

	const handleBlur = () => {
		handleSubmit(name)
	}

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setName(e.target.value)
	}

	const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
		// stop propagation of the click event so it doesn't trigger an action (eg. extract archive, open, etc.)
		// in case the user clicks on the input to select text
		e.stopPropagation()
	}

	const inputStyles = cn(
		'bg-transparent outline-none ring-1 ring-transparent',
		'p-0 m-0 box-border leading-[16px] tracking-[-0.04em]',
		// Show ring outline only on touch devices so that it is obvious that the input is focused
		isTouchDevice && 'focus:ring-[hsl(var(--color-brand))]',
		// icons view specific styles
		view === 'icons' && 'mt-1 line-clamp-2 w-full text-12 leading-tight text-center',
		// list view specific styles
		view === 'list' && 'text-12 w-full min-w-0 truncate',
	)

	return (
		<input
			ref={inputRef}
			type='text'
			value={name}
			onChange={handleChange}
			onKeyDown={handleKeyDown}
			onClick={handleClick}
			onDoubleClick={handleClick}
			onBlur={handleBlur}
			className={inputStyles}
		/>
	)
}
