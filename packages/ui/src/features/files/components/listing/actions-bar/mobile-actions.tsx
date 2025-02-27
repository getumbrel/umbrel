import {RiArrowDropDownLine, RiArrowDropUpLine} from 'react-icons/ri'
import {TbDots} from 'react-icons/tb'

import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {Button} from '@/shadcn-components/ui/button'
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
} from '@/shadcn-components/ui/dropdown-menu'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

export function MobileActions({DropdownItems = null}: {DropdownItems?: React.ReactNode}) {
	const {preferences, setView, setSortBy} = usePreferences()
	const isSelectingOnMobile = useFilesStore((state) => state.isSelectingOnMobile)
	const toggleIsSelectingOnMobile = useFilesStore((state) => state.toggleIsSelectingOnMobile)

	return (
		<div className='flex items-center gap-2'>
			<Button
				className={cn(
					'h-8 rounded-full px-3 text-13',
					'focus:ring-0 focus:ring-offset-0 focus-visible:ring-0',
					'focus:outline-none focus-visible:outline-none',
				)}
				variant={isSelectingOnMobile ? 'secondary' : 'default'}
				size='default'
				aria-label={t('files-action.select')}
				onClick={toggleIsSelectingOnMobile}
			>
				{isSelectingOnMobile ? t('done') : t('files-action.select')}
			</Button>

			<DropdownMenu>
				<DropdownMenuTrigger className='focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0'>
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
												{preferences.sortOrder === 'asc' ? (
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
