import {useState} from 'react'

import {FileItemContextMenu} from '@/features/files/components/listing/file-item/file-item-context-menu'
import {IconsViewFileItem} from '@/features/files/components/listing/file-item/icons-view-file-item'
import {ListViewFileItem} from '@/features/files/components/listing/file-item/list-view-file-item'
import {Draggable, Droppable} from '@/features/files/components/shared/drag-and-drop'
import {useItemClick} from '@/features/files/hooks/use-item-click'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {cn} from '@/shadcn-lib/utils'

interface FileItemProps {
	item: FileSystemItem
	items: FileSystemItem[]
}

export const FileItem = ({item, items}: FileItemProps) => {
	const {handleClick, handleDoubleClick} = useItemClick()
	const isItemSelected = useFilesStore((state) => state.isItemSelected)
	const clipboardItems = useFilesStore((state) => state.clipboardItems)
	const clipboardMode = useFilesStore((state) => state.clipboardMode)

	const [isEditingName, setIsEditingName] = useState(false)
	const isUploading = 'isUploading' in item && item.isUploading
	const isSelected = isItemSelected(item)
	const {preferences} = usePreferences()
	const view = preferences?.view

	const handleRenameClick = () => {
		setIsEditingName(true)
	}

	const handlNameEditingComplete = () => {
		setIsEditingName(false)
	}

	const isDotfile = (filename: string) => filename.startsWith('.')

	const isItemCut = clipboardMode === 'cut' && clipboardItems.find((i) => i.path === item.path)

	const isEditingFileName = isEditingName || !!('isNew' in item && item.isNew)

	return (
		<div
			data-selected={isItemSelected(item) ? 'true' : 'false'}
			className={cn(
				`files-${view}-view-file-item`, // .files-list-view-file-item styles are applied via CSS using combinator classes
				'rounded-lg transition-colors duration-100',
				isSelected && 'bg-brand/10 shadow-[0_0_0_1px_theme(colors.brand)]', // selected item styles for list view are overwritten by CSS
				!isSelected && !isUploading && 'md:hover:!border-white/6 md:hover:!bg-white/5', // don't show hover state for selected items or uploading items
			)}
			data-marquee-selection-item-path={!isUploading ? item.path : ''} // don't enable marquee selection for uploading items
		>
			<FileItemContextMenu item={item} onRenameClick={handleRenameClick}>
				<Droppable
					id={`${view}-view-file-item-${item.path}`}
					path={item.path}
					disabled={!!isUploading || item.type !== 'directory'}
					className='rounded-lg'
				>
					<Draggable id={`${view}-view-file-item-${item.path}`} item={item} disabled={!!isUploading}>
						<div
							onClick={(e) => handleClick(e, item, items)}
							onDoubleClick={() => handleDoubleClick(item)}
							className={cn(isItemCut && 'opacity-50')}
							role='button'
						>
							{/* If the item is a dotfile, we decrease the brightness and opacity for the icon and text for a faded look */}
							<div className={cn(isDotfile(item.name) && 'opacity-50 brightness-75')}>
								{view === 'icons' ? (
									<IconsViewFileItem
										item={item}
										isEditingName={isEditingFileName}
										onEditingNameComplete={handlNameEditingComplete}
									/>
								) : null}
								{view === 'list' ? (
									<ListViewFileItem
										item={item}
										isEditingName={isEditingFileName}
										onEditingNameComplete={handlNameEditingComplete}
									/>
								) : null}
							</div>
						</div>
					</Draggable>
				</Droppable>
			</FileItemContextMenu>
		</div>
	)
}
