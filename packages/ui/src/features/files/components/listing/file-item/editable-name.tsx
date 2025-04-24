import {useEffect, useRef, useState} from 'react'
import {AiOutlineFileExclamation} from 'react-icons/ai'

import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {useConfirmation} from '@/providers/confirmation'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Button} from '@/shadcn-components/ui/button'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {Input, Labeled} from '@/shadcn-components/ui/input'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

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
	const isMobile = useIsMobile()
	const dialogProps = useSettingsDialogProps()

	const {renameItem} = useFilesOperations()
	const {cancelNewFolder, createFolder} = useNewFolder()
	const confirm = useConfirmation()

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

	const handleSubmit = async (submittedName: string) => {
		const trimmedName = submittedName.trim()
		let performRename = true
		if (isCreatingNewFolder) {
			// Calculate parent path and the full path for the new folder
			const parentPath = path.split('/').slice(0, -1).join('/')
			const fullPath = `${parentPath}/${trimmedName}`
			createFolder.mutate({path: fullPath})
		} else {
			// check if the user is changing the extension of a file
			if (item.type !== 'directory') {
				const {extension: currentNameExtension} = splitFileName(initialName)
				const {extension: toNameExtension} = splitFileName(trimmedName)

				// if the extension is changing, show the extension change confirmation dialog
				// and let it handle the renaming
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
								{label: t('files-extension-change.confirm'), value: 'confirm', variant: 'destructive'},
								{label: t('cancel'), value: 'cancel', variant: 'default'},
							],
							icon: AiOutlineFileExclamation,
						})
						// Confirmation passed, proceed with rename (handled below)
					} catch (error) {
						// User cancelled confirmation
						performRename = false
					}
				}
			}
			if (performRename) {
				renameItem({item, newName: trimmedName})
			}
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
		'bg-transparent outline-none ring-1 ring-transparent',
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
								<Button type='button' size='dialog' onClick={handleClose}>
									{t('cancel')}
								</Button>
								<Button type='submit' size='dialog' variant='primary'>
									{t('ok')}
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
			onBlur={() => handleSubmit(name)}
			className={inputStyles}
		/>
	)
}
