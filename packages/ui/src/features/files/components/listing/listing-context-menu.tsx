import {RiArrowDropDownLine, RiArrowDropUpLine} from 'react-icons/ri'

import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from '@/shadcn-components/ui/context-menu'
import {t} from '@/utils/i18n'

interface ListingContextMenuProps {
	children: React.ReactNode
	menuItems?: React.ReactNode
}

export function ListingContextMenu({children, menuItems}: ListingContextMenuProps) {
	const {preferences, setView, setSortBy} = usePreferences()

	return (
		<ContextMenu modal={false}>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			{/* Hide listing context menu on mobile as all the actions are in the actions bar's dropdown menu */}
			<ContextMenuContent className='w-44'>
				{menuItems ? (
					<>
						{menuItems}
						<ContextMenuSeparator />
					</>
				) : null}
				<ContextMenuSub>
					<ContextMenuSubTrigger>{t('files-view.view-as')}</ContextMenuSubTrigger>
					<ContextMenuSubContent className='w-28'>
						<ContextMenuCheckboxItem checked={preferences?.view === 'list'} onCheckedChange={() => setView('list')}>
							{t('files-view.list')}
						</ContextMenuCheckboxItem>
						<ContextMenuCheckboxItem checked={preferences?.view === 'icons'} onCheckedChange={() => setView('icons')}>
							{t('files-view.icons')}
						</ContextMenuCheckboxItem>
					</ContextMenuSubContent>
				</ContextMenuSub>
				<ContextMenuSub>
					<ContextMenuSubTrigger>{t('files-view.sort-by')}</ContextMenuSubTrigger>
					<ContextMenuSubContent className='w-24'>
						{SORT_BY_OPTIONS.map((option) => (
							<ContextMenuItem
								key={option.sortBy}
								onClick={() => setSortBy(option.sortBy)}
								className='flex items-center justify-between'
							>
								{t(option.labelTKey)}
								{option.sortBy === preferences?.sortBy && (
									<>
										{preferences.sortOrder === 'asc' ? (
											<RiArrowDropUpLine className='h-5 w-5' />
										) : (
											<RiArrowDropDownLine className='h-5 w-5' />
										)}
									</>
								)}
							</ContextMenuItem>
						))}
					</ContextMenuSubContent>
				</ContextMenuSub>
			</ContextMenuContent>
		</ContextMenu>
	)
}
