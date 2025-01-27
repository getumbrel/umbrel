import {RiArrowDropDownLine, RiArrowDropUpLine} from 'react-icons/ri'

import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {Table, TableCell, TableHeader, TableRow} from '@/shadcn-components/ui/table'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

interface ListingBodyProps {
	children: React.ReactNode
	scrollAreaRef: React.RefObject<HTMLDivElement> // used by marquee selection for scrolling
}

export const ListingBody = ({children, scrollAreaRef}: ListingBodyProps) => {
	const {preferences, setSortBy} = usePreferences()

	// Icons view
	if (preferences?.view === 'icons') {
		return (
			<ScrollArea viewportRef={scrollAreaRef} className='h-full'>
				<div
					role='grid'
					className='mx-auto grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-3 p-3 focus:outline-none md:p-6'
					aria-label='Files and folders grid'
				>
					{children}
				</div>
			</ScrollArea>
		)
	}

	// List view
	if (preferences?.view === 'list') {
		return (
			<div className='flex h-full flex-col overflow-hidden'>
				{/* Desktop table header - hidden on mobile */}
				<div className='hidden flex-none lg:mx-6 lg:block'>
					<Table>
						<TableHeader>
							<TableRow className='cursor-default border-none'>
								<TableCell colSpan={5} className='p-0'>
									<div className='flex'>
										{SORT_BY_OPTIONS.map((option) => (
											<button
												key={option.sortBy}
												className={cn(
													'flex items-center justify-between overflow-hidden text-ellipsis whitespace-nowrap p-2.5 text-12 text-white/70',
													option.sortBy === 'name' && 'flex-[3]',
													option.sortBy === 'modified' && 'flex-[2]',
													option.sortBy === 'size' && 'flex-[1]',
													option.sortBy === 'created' && 'flex-[2] lg:hidden xl:flex',
													option.sortBy === 'type' && 'flex-[2]',
												)}
												onClick={() => setSortBy(option.sortBy)}
											>
												{t(option.labelTKey)}
												{option.sortBy === preferences.sortBy && preferences.sortOrder === 'asc' && (
													<RiArrowDropUpLine className='h-5 w-5' />
												)}
												{option.sortBy === preferences.sortBy && preferences.sortOrder === 'desc' && (
													<RiArrowDropDownLine className='h-5 w-5' />
												)}
											</button>
										))}
									</div>
								</TableCell>
							</TableRow>
						</TableHeader>
					</Table>
				</div>

				<div className='flex-1 overflow-hidden'>
					<ScrollArea viewportRef={scrollAreaRef} className='h-full'>
						<div className='p-3 focus:outline-none md:px-6 md:pb-6 md:pt-0'>{children}</div>
					</ScrollArea>
				</div>
			</div>
		)
	}

	return null
}
