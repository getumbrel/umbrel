import {ChevronDown, ChevronUp} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {VirtualizedList} from '@/features/files/components/listing/virtualized-list'
import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useIsFilesEmbedded} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {cn} from '@/lib/utils'

interface ListingBodyProps {
	children?: React.ReactNode
	scrollAreaRef: React.RefObject<HTMLDivElement | null> // the listing's scroller, once it has items to show
	items: FileSystemItem[]
	selectableItems?: FileSystemItem[]
	hiddenRenamedPaths?: string[]
	hasMore: boolean
	isLoading: boolean
	onLoadMore: (startIndex: number) => Promise<boolean>
	onLoadAll?: () => Promise<boolean>
}

// The columns' share of the row, the same as the rows' own (see ListViewFileItem)
const COLUMN_CLASS = {
	name: 'flex-[5]',
	modified: 'min-w-[12em] flex-[2]',
	size: 'min-w-[6.5em] flex-1',
	type: 'flex-[2]',
} as const

export const ListingBody = ({
	scrollAreaRef,
	items,
	selectableItems,
	hiddenRenamedPaths,
	hasMore,
	isLoading,
	onLoadMore,
	onLoadAll,
}: ListingBodyProps) => {
	const {t} = useTranslation()
	const {preferences, setSortBy} = usePreferences()
	const isEmbedded = useIsFilesEmbedded()
	// A touch screen is selecting: the rows make room for their circles, and the names' heading goes with them
	const isSelecting = useFilesStore((state) => state.isSelectingOnMobile)
	// A search's results and Recents come in their own order, from all over:
	// their columns are only labels, the last one saying where each item lives
	const {isBrowsingSearch, isBrowsingRecents} = useNavigate()
	const showLocation = isBrowsingSearch || isBrowsingRecents

	// Icons view
	if (preferences?.view === 'icons') {
		return (
			<VirtualizedList
				scrollAreaRef={scrollAreaRef}
				items={items}
				selectableItems={selectableItems}
				hiddenRenamedPaths={hiddenRenamedPaths}
				hasMore={hasMore}
				isLoading={isLoading}
				onLoadMore={onLoadMore}
				onLoadAll={onLoadAll}
				view='icons'
			/>
		)
	}

	// List view
	if (preferences?.view === 'list') {
		const Direction = preferences.sortOrder === 'descending' ? ChevronDown : ChevronUp
		return (
			<div className='flex h-full flex-col'>
				{/* The columns' names on a desktop, each a way to sort by it. A phone's
				    rows have no columns to name. */}
				<div
					className={cn(
						'hidden h-8 flex-none items-center border-b border-white/6 text-12 text-white/45 lg:flex',
						isEmbedded && 'lg:mx-6',
					)}
				>
					{SORT_BY_OPTIONS.map((option) => {
						const isSorted = !showLocation && option.sortBy === preferences.sortBy
						const label = showLocation && option.sortBy === 'type' ? t('files-sort.location') : t(option.labelTKey)
						const className = cn(
							'flex h-full items-center gap-1 overflow-hidden px-2.5 text-left whitespace-nowrap',
							COLUMN_CLASS[option.sortBy],
							// The names' heading moves over with the names (see ListViewFileItem)
							option.sortBy === 'name'
								? 'transition-[padding,color] duration-200 ease-out motion-reduce:transition-[color]'
								: 'transition-colors',
							option.sortBy === 'name' && isSelecting && 'pl-[42px]',
						)
						if (showLocation)
							return (
								<span key={option.sortBy} className={className}>
									<span className='min-w-0 truncate'>{label}</span>
								</span>
							)
						return (
							<button
								key={option.sortBy}
								type='button'
								className={cn(
									className,
									'outline-hidden hover:text-white/80 focus-visible:text-white',
									isSorted && 'text-white/80',
								)}
								onClick={() => setSortBy(option.sortBy)}
							>
								<span className='min-w-0 truncate'>{label}</span>
								{isSorted && <Direction className='size-3.5 shrink-0' strokeWidth={2.5} aria-hidden />}
							</button>
						)
					})}
				</div>

				<div className='min-h-0 flex-1'>
					<VirtualizedList
						scrollAreaRef={scrollAreaRef}
						items={items}
						selectableItems={selectableItems}
						hiddenRenamedPaths={hiddenRenamedPaths}
						hasMore={hasMore}
						isLoading={isLoading}
						onLoadMore={onLoadMore}
						onLoadAll={onLoadAll}
						view='list'
					/>
				</div>
			</div>
		)
	}

	return null
}
