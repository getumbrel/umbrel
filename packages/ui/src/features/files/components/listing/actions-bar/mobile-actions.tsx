import {useTranslation} from 'react-i18next'
import {RiArrowDropDownLine, RiArrowDropUpLine} from 'react-icons/ri'
import {TbDots} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {useActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {SearchInput} from '@/features/files/components/listing/actions-bar/search-input'
import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {cn} from '@/lib/utils'
import {focusRingClass, touchTargetClass} from '@/utils/element-classes'

// Turns tapping into selecting, for screens with no mouse to select with
export function SelectToggle({className}: {className?: string}) {
	const {t} = useTranslation()
	const isSelectingOnMobile = useFilesStore((state) => state.isSelectingOnMobile)
	const setIsSelectingOnMobile = useFilesStore((state) => state.setIsSelectingOnMobile)

	return (
		<Button
			className={cn('h-[1.9rem] rounded-full px-3 text-13', className)}
			variant={isSelectingOnMobile ? 'secondary' : 'default'}
			size='default'
			aria-label={t('files-action.select')}
			onClick={() => setIsSelectingOnMobile(!isSelectingOnMobile)}
		>
			{isSelectingOnMobile ? t('done') : t('files-action.select')}
		</Button>
	)
}

export function MobileActions({DropdownItems = null}: {DropdownItems?: React.ReactNode}) {
	const {t} = useTranslation()
	const {preferences, setView, setSortBy} = usePreferences()
	const {hideSearch, mobilePrimaryAction} = useActionsBarConfig()
	const isReadOnly = useIsFilesReadOnly()

	return (
		<div className='flex items-center gap-2'>
			{/* Search (hide in read-only or when explicitly hidden) */}
			{!hideSearch && !isReadOnly ? <SearchInput /> : null}

			{/* Select toggle button, or the listing's own primary action where
			    selection is meaningless */}
			{mobilePrimaryAction ?? <SelectToggle />}

			<DropdownMenu>
				<DropdownMenuTrigger className={cn(touchTargetClass, '-m-0.5 rounded-full p-0.5', focusRingClass)}>
					<TbDots className='h-5 w-5' />
				</DropdownMenuTrigger>
				<DropdownMenuContent className='w-44' align='start'>
					{DropdownItems ? (
						<>
							{DropdownItems}
							<DropdownMenuSeparator />
						</>
					) : null}
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>{t('files-view.view-as')}</DropdownMenuSubTrigger>
						<DropdownMenuPortal>
							<DropdownMenuSubContent>
								<DropdownMenuCheckboxItem
									checked={preferences?.view === 'icons'}
									onCheckedChange={() => setView('icons')}
								>
									{t('files-view.icons')}
								</DropdownMenuCheckboxItem>
								<DropdownMenuCheckboxItem
									checked={preferences?.view === 'list'}
									onCheckedChange={() => setView('list')}
								>
									{t('files-view.list')}
								</DropdownMenuCheckboxItem>
							</DropdownMenuSubContent>
						</DropdownMenuPortal>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>{t('files-view.sort-by')}</DropdownMenuSubTrigger>
						<DropdownMenuPortal>
							<DropdownMenuSubContent>
								{SORT_BY_OPTIONS.map((option) => (
									<DropdownMenuItem
										key={option.sortBy}
										onClick={() => setSortBy(option.sortBy)}
										className='flex items-center justify-between'
									>
										{t(option.labelTKey)}
										{option.sortBy === preferences?.sortBy && (
											<>
												{preferences.sortOrder === 'ascending' ? (
													<RiArrowDropUpLine className='h-5 w-5' />
												) : (
													<RiArrowDropDownLine className='h-5 w-5' />
												)}
											</>
										)}
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuPortal>
					</DropdownMenuSub>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}
