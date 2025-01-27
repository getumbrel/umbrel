import {RiArrowLeftSLine, RiArrowRightSLine} from 'react-icons/ri'
import {useSearchParams} from 'react-router-dom'

import {ITEMS_PER_PAGE} from '@/features/files/constants'
import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from '@/shadcn-components/ui/pagination'
import {t} from '@/utils/i18n'

// Constants for pagination configuration
const VISIBLE_PAGES_AROUND_CURRENT = 1
const MINIMUM_PAGE = 1

// Checks if we need to show ellipsis before or after page numbers
function shouldShowEllipsis(currentPage: number, totalPages: number) {
	return {
		beforeCurrent: currentPage - VISIBLE_PAGES_AROUND_CURRENT > 2,
		afterCurrent: currentPage + VISIBLE_PAGES_AROUND_CURRENT < totalPages - 1,
	}
}

// Generates the range of page numbers around the current page
function getVisiblePageRange(currentPage: number, totalPages: number): number[] {
	const startPage = Math.max(2, currentPage - VISIBLE_PAGES_AROUND_CURRENT)
	const endPage = Math.min(totalPages - 1, currentPage + VISIBLE_PAGES_AROUND_CURRENT)

	const range: number[] = []
	for (let i = startPage; i <= endPage; i++) {
		range.push(i)
	}
	return range
}

// Generates the complete pagination array with numbers and ellipsis
function getPaginationRange(currentPage: number, totalPages: number): Array<string | number> {
	// Handle simple cases
	if (totalPages <= 1) return [1]

	// Get the range of visible page numbers
	const visiblePages = getVisiblePageRange(currentPage, totalPages)

	// Check where we need ellipsis
	const {beforeCurrent, afterCurrent} = shouldShowEllipsis(currentPage, totalPages)

	// Build the final array
	const pages: Array<string | number> = [1]
	if (beforeCurrent) pages.push('…')
	pages.push(...visiblePages)
	if (afterCurrent) pages.push('…')
	if (totalPages > 1) pages.push(totalPages)

	return pages
}

export const ListingFooter = ({totalItems}: {totalItems: number}) => {
	const [searchParams, setSearchParams] = useSearchParams()
	const currentPage = parseInt(searchParams.get('page') || '1')

	const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE)

	const pages = getPaginationRange(currentPage, totalPages)

	// Handle page navigation with bounds checking
	const handlePageClick = (pageNumber: number) => {
		const isValidPage = pageNumber >= MINIMUM_PAGE && pageNumber <= totalPages
		const isDifferentPage = pageNumber !== currentPage

		if (isValidPage && isDifferentPage) {
			setSearchParams({page: String(pageNumber)})
		}
	}

	// Don't show pagination if there's only one page
	if (totalPages <= 1) return null

	return (
		<Pagination className='pb-4'>
			<PaginationContent>
				{/* Previous page button */}
				<PaginationItem>
					<PaginationPrevious
						onClick={() => handlePageClick(currentPage - 1)}
						aria-disabled={currentPage === MINIMUM_PAGE}
						className={`${currentPage === MINIMUM_PAGE ? 'pointer-events-none opacity-50' : ''} h-7 w-7 px-2`}
						size='sm'
						aria-label={t('files-pagination.previous')}
					>
						<RiArrowLeftSLine className='h-7 w-7' />
					</PaginationPrevious>
				</PaginationItem>

				{/* Page numbers and ellipsis */}
				{pages.map((page, index) => (
					<PaginationItem key={`page-${page}-${index}`}>
						{typeof page === 'string' ? (
							<PaginationEllipsis className='text-12 opacity-50' />
						) : (
							<PaginationLink
								onClick={() => handlePageClick(page)}
								isActive={page === currentPage}
								size='sm'
								className='h-7 w-7 text-12'
								aria-label={t('files-pagination.page', {page})}
							>
								{page}
							</PaginationLink>
						)}
					</PaginationItem>
				))}

				{/* Next page button */}
				<PaginationItem>
					<PaginationNext
						onClick={() => handlePageClick(currentPage + 1)}
						aria-disabled={currentPage === totalPages}
						className={`${currentPage === totalPages ? 'pointer-events-none opacity-50' : ''} h-7 w-7 px-2`}
						size='sm'
						aria-label={t('files-pagination.next')}
					>
						<RiArrowRightSLine className='h-4 w-4' />
					</PaginationNext>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	)
}
