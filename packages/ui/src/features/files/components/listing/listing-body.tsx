import {RiArrowDropDownLine, RiArrowDropUpLine} from 'react-icons/ri'

import {VirtualizedList} from '@/features/files/components/listing/virtualized-list'
import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import type {FileSystemItem} from '@/features/files/types'
import {Table, TableCell, TableHeader, TableRow} from '@/shadcn-components/ui/table'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

interface ListingBodyProps {
	children?: React.ReactNode
	scrollAreaRef: React.RefObject<HTMLDivElement> // used by marquee selection for scrolling
	items: FileSystemItem[]
	hasMore: boolean
	isLoading: boolean
	onLoadMore: (startIndex: number) => Promise<boolean>
}

export const ListingBody = ({scrollAreaRef, items, hasMore, isLoading, onLoadMore}: ListingBodyProps) => {
	const {preferences, setSortBy} = usePreferences()

	// Icons view
	if (preferences?.view === 'icons') {
		return (
			<VirtualizedList
				scrollAreaRef={scrollAreaRef}
				items={items}
				hasMore={hasMore}
				isLoading={isLoading}
				onLoadMore={onLoadMore}
				view='icons'
			/>
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
								<TableCell colSpan={5} className='py-0 pl-0 pr-0'>
									<div className='flex'>
										{SORT_BY_OPTIONS.map((option) => (
											<button
												key={option.sortBy}
												className={cn(
													'flex items-center justify-between overflow-hidden text-ellipsis whitespace-nowrap p-2.5 text-12 text-white/70',
													option.sortBy === 'name' && 'flex-[5]',
													option.sortBy === 'modified' && 'flex-[2]',
													option.sortBy === 'size' && 'flex-[1]',
													// TODO: Add this back in when we have a file system index in umbreld. The name column was previously flex-[3]
													// option.sortBy === 'created' && 'flex-[2] lg:hidden xl:flex',
													option.sortBy === 'type' && 'flex-[2]',
												)}
												onClick={() => setSortBy(option.sortBy)}
											>
												{t(option.labelTKey)}
												{option.sortBy === preferences.sortBy && preferences.sortOrder === 'ascending' && (
													<RiArrowDropUpLine className='h-5 w-5' />
												)}
												{option.sortBy === preferences.sortBy && preferences.sortOrder === 'descending' && (
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
					<VirtualizedList
						scrollAreaRef={scrollAreaRef}
						items={items}
						hasMore={hasMore}
						isLoading={isLoading}
						onLoadMore={onLoadMore}
						view='list'
					/>
				</div>
			</div>
		)
	}

	return null
}
