import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {AiOutlineFileExclamation} from 'react-icons/ai'

import {Button} from '@/components/ui/button'
import {Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle} from '@/components/ui/drawer'
import {Input, Labeled} from '@/components/ui/input'
import {toast} from '@/components/ui/toast'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'

interface EditableNameProps {
	item: FileSystemItem
	view: 'icons' | 'list'
	onFinish: () => void
}

export const EditableName = ({item, view, onFinish}: EditableNameProps) => {
	const {t} = useTranslation()
	const {name: initialName, path} = item
	const inputRef = useRef<HTMLInputElement>(null)
	const [name, setName] = useState(initialName)
	const isTouchDevice = useIsTouchDevice()
	const isMobile = useIsMobile()
	const dialogProps = useSettingsDialogProps()

	const {renameItem} = useFilesOperations()
	const {cancelNewFolder, commitNewFolder} = useNewFolder()
	const confirm = useConfirmation()
	const {currentPath} = useNavigate()
	const {listing} = useListDirectory(currentPath)
	// Opening the extension dialog blurs the input, which would submit the name a second time
	const isSubmittingRef = useRef(false)

	const isCreatingNewFolder = 'isNew' in item && item.isNew
	const isFolder = item.type === 'directory'

	// Wording for the mobile drawer for naming/renaming a folder or file
	const drawerTitle = isCreatingNewFolder
		? t('files-name-drawer.new-folder')
		: isFolder
			? t('files-name-drawer.rename-folder')
			: t('files-name-drawer.rename-file')
	const drawerDescription = isCreatingNewFolder
		? t('files-name-drawer.new-folder-description')
		: isFolder
			? t('files-name-drawer.rename-folder-description')
			: t('files-name-drawer.rename-file-description')
	const inputLabel = isCreatingNewFolder
		? t('files-name-drawer.new-folder-input')
		: isFolder
			? t('files-name-drawer.rename-folder-input')
			: t('files-name-drawer.rename-file-input')

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

	const parentPath = path.slice(0, path.lastIndexOf('/'))

	// Gives up on the name: drops the new folder, or leaves the item as it was
	const cancel = () => (isCreatingNewFolder ? cancelNewFolder() : onFinish())

	// Why a name can't be used, found before anything changes on screen. Only the loaded part
	// of the folder being browsed is known here. The server rejects any other clash on rename,
	// but creating a folder that already exists quietly does nothing.
	const getNameProblem = (newName: string) => {
		const failed = (message: string) =>
			isCreatingNewFolder ? t('files-error.create-folder', {message}) : t('files-error.rename', {message})

		if (newName.includes('/') || newName === '.' || newName === '..') {
			return failed(t('files-backend-error.invalid-filename'))
		}
		const isTaken =
			parentPath === currentPath && listing?.items.some((other) => other.name === newName && other.path !== path)
		if (isTaken) {
			return isCreatingNewFolder
				? t('files-error.folder-already-exists')
				: failed(t('files-backend-error.destination-already-exists'))
		}
	}

	const submit = async (submittedName: string, {isBlur}: {isBlur: boolean}) => {
		if (!isCreatingNewFolder && submittedName === initialName) return onFinish()
		const newName = submittedName.trim()
		if (!newName) return cancel()

		const problem = getNameProblem(newName)
		if (problem) {
			// One toast per name, even when Enter and then a click away both find the problem
			toast.error(problem, {area: 'files', id: `files-name-problem-${path}`})
			// After Enter the name stays in the field to be fixed. Clicking away gives up on it.
			return isBlur ? cancel() : undefined
		}

		if (isCreatingNewFolder) return commitNewFolder(`${parentPath}/${newName}`)

		// Changing a file's extension can change how it opens, so it is confirmed first
		if (item.type !== 'directory') {
			const {extension: currentNameExtension} = splitFileName(initialName)
			const {extension: toNameExtension} = splitFileName(newName)

			if (currentNameExtension !== toNameExtension) {
				try {
					await confirm({
						title: toNameExtension
							? t('files-extension-change.title-add', {extension: toNameExtension})
							: t('files-extension-change.title-remove'),
						message: toNameExtension
							? t('files-extension-change.description-add', {
									fileName: initialName,
									extension: toNameExtension,
								})
							: t('files-extension-change.description-remove', {fileName: initialName}),
						actions: [
							{label: t('files-extension-change.confirm'), value: 'confirm', variant: 'primary'},
							{label: t('cancel'), value: 'cancel', variant: 'default'},
						],
						icon: AiOutlineFileExclamation,
					})
				} catch {
					return onFinish()
				}
			}
		}
		renameItem({item, newName})
		onFinish()
	}

	const handleSubmit = async (submittedName: string, {isBlur = false} = {}) => {
		if (isSubmittingRef.current) return
		isSubmittingRef.current = true
		try {
			await submit(submittedName, {isBlur})
		} finally {
			isSubmittingRef.current = false
		}
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
			return cancel()
		}
	}

	const preventClickPropagation = (e: React.MouseEvent) => {
		// stop propagation of the click event so it doesn't trigger an action (eg. extract archive, open, etc.)
		e.stopPropagation()
	}

	const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		handleSubmit(name)
	}

	const handleClose = () => {
		if (isCreatingNewFolder) {
			cancelNewFolder()
		} else {
			onFinish()
		}
	}

	const inputStyles = cn(
		'bg-transparent outline-hidden ring-1 ring-transparent',
		'p-0 m-0 box-border leading-[16px] tracking-[-0.04em]',
		// Show ring outline only on touch devices so that it is obvious that the input is focused
		isTouchDevice && 'focus:ring-[hsl(var(--color-brand))]',
		// icons view specific styles
		view === 'icons' && 'mt-1 line-clamp-2 w-full text-12 leading-tight text-center',
		// list view specific styles
		view === 'list' && 'text-12 w-full min-w-0 truncate',
	)

	if (isMobile) {
		return (
			<Drawer
				{...dialogProps}
				// We set non-modal for this Drawer only on touch devices to prevent an issue where tapping the overlay to close the drawer causes a residual click event to
				// propagate to the underlying FileItem (where this drawer component is rendered) and tiggers unwanted actions like navigation or reopening the drawer.
				// We should investigate further in the future and potentially fix this somewhere higher in the layout tree.
				modal={!isTouchDevice}
				// ensure state is reset properly when the drawer is closed
				onOpenChange={(isOpen) => {
					if (!isOpen) {
						handleClose()
					}
				}}
			>
				{/* prevent clicks inside the drawer from triggering actions */}
				<DrawerContent onClick={preventClickPropagation} onDoubleClick={preventClickPropagation}>
					<DrawerHeader>
						<DrawerTitle>{drawerTitle}</DrawerTitle>
						<DrawerDescription>{drawerDescription}</DrawerDescription>
					</DrawerHeader>
					<form onSubmit={handleFormSubmit} onClick={preventClickPropagation} className='flex flex-1 flex-col'>
						<fieldset className='flex flex-1 flex-col gap-5'>
							<Labeled label={inputLabel}>
								<Input
									value={name}
									onClick={preventClickPropagation}
									onDoubleClick={preventClickPropagation}
									onValueChange={setName}
									onKeyDown={handleKeyDown}
								/>
							</Labeled>
							<div className='flex-1' />
							<DrawerFooter>
								<Button type='submit' size='dialog' variant='primary'>
									{t('ok')}
								</Button>
								<Button type='button' size='dialog' onClick={handleClose}>
									{t('cancel')}
								</Button>
							</DrawerFooter>
						</fieldset>
					</form>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<input
			ref={inputRef}
			type='text'
			value={name}
			onChange={(e) => setName(e.target.value)}
			onKeyDown={handleKeyDown}
			onClick={preventClickPropagation}
			onDoubleClick={preventClickPropagation}
			onBlur={() => handleSubmit(name, {isBlur: true})}
			className={inputStyles}
		/>
	)
}
