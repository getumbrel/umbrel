import {ArrowDown, ArrowUp} from 'lucide-react'
import {Fragment} from 'react'
import {useTranslation} from 'react-i18next'

import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {useActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {useItemActions} from '@/features/files/hooks/use-item-actions'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'

interface ListingAndFileItemContextMenuProps {
	children: React.ReactNode
}

// The menu under the pointer. Over an item it is about the selection (the
// item selects itself when right-clicked) and offers everything that can be
// done to it (see useItemActions). Over empty space it is about the folder:
// what the listing lets you add to it, then how it is shown and ordered.
export function ListingAndFileItemContextMenu({children}: ListingAndFileItemContextMenuProps) {
	const {t} = useTranslation()
	const isReadOnly = useIsFilesReadOnly()
	const {preferences, setView, setSortBy} = usePreferences()
	const {actions = []} = useActionsBarConfig()

	const selectedItems = useFilesStore((state) => state.selectedItems)
	const setSelectedItems = useFilesStore((state) => state.setSelectedItems)
	const {groups} = useItemActions()

	// If read-only, just render children without wrapping menu
	if (isReadOnly) return <>{children}</>

	const isFileMenu = selectedItems.length > 0
	// A drive in /External, or an item still uploading, has nothing to offer
	if (isFileMenu && groups.length === 0) return children

	const Direction = preferences?.sortOrder === 'descending' ? ArrowDown : ArrowUp

	return (
		<ContextMenu modal={false}>
			<ContextMenuTrigger
				asChild
				// An item selects itself when right-clicked. A right-click on empty space is about the
				// folder, so, as in Finder, it drops the selection and the menu offers New Folder and Paste.
				onContextMenu={(e) => {
					if (!(e.target as Element).closest('[data-files-item]')) setSelectedItems([])
				}}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent className='w-52'>
				{isFileMenu ? (
					groups.map((group, index) => (
						<Fragment key={group.map((action) => action.id).join()}>
							{index > 0 && <ContextMenuSeparator />}
							{group.map((action) => (
								<ContextMenuItem
									key={action.id}
									disabled={action.disabled}
									onClick={action.onSelect}
									className={action.destructive ? contextMenuClasses.item.rootDestructive : undefined}
								>
									{action.label}
									{action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
								</ContextMenuItem>
							))}
						</Fragment>
					))
				) : (
					<>
						{actions.length > 0 && (
							<>
								{actions.map((action) => (
									<ContextMenuItem key={action.id} disabled={action.disabled} onClick={action.onSelect}>
										{action.label}
										{action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
									</ContextMenuItem>
								))}
								<ContextMenuSeparator />
							</>
						)}
						<ContextMenuSub>
							<ContextMenuSubTrigger>{t('files-view.view-as')}</ContextMenuSubTrigger>
							<ContextMenuSubContent className='w-32'>
								<ContextMenuCheckboxItem checked={preferences?.view === 'list'} onCheckedChange={() => setView('list')}>
									{t('files-view.list')}
								</ContextMenuCheckboxItem>
								<ContextMenuCheckboxItem
									checked={preferences?.view === 'icons'}
									onCheckedChange={() => setView('icons')}
								>
									{t('files-view.icons')}
								</ContextMenuCheckboxItem>
							</ContextMenuSubContent>
						</ContextMenuSub>
						<ContextMenuSub>
							<ContextMenuSubTrigger>{t('files-view.sort-by')}</ContextMenuSubTrigger>
							<ContextMenuSubContent className='w-36'>
								{SORT_BY_OPTIONS.map((option) => (
									<ContextMenuItem
										key={option.sortBy}
										onClick={() => setSortBy(option.sortBy)}
										className='flex items-center justify-between'
									>
										{t(option.labelTKey)}
										{option.sortBy === preferences?.sortBy && <Direction className='size-3.5 text-white/60' />}
									</ContextMenuItem>
								))}
							</ContextMenuSubContent>
						</ContextMenuSub>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	)
}
