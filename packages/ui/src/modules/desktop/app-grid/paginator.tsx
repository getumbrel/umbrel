import {cva} from 'class-variance-authority'
import {useEffect, useRef, useState} from 'react'

import CaretRight from '@/assets/caret-right'
import {cn} from '@/shadcn-lib/utils'

const DATA_INDEX_ATTR = 'data-index'

export function usePaginator(pageCount: number) {
	const [page, setPage] = useState<number>(0)
	const [scrollingWithCode, setScrollingWithCode] = useState(false)

	const scrollContainer = useRef<HTMLDivElement>(null)

	const scrollToPage = (page: number) => {
		setScrollingWithCode(true)
		setPage(page)
		if (!scrollContainer.current) return
		// console.log("scroll with code", page);
		scrollContainer.current.scrollTo({
			behavior: 'smooth',
			left: page * scrollContainer.current.clientWidth,
		})
	}

	const handlePrev = () => scrollToPage(page - 1)
	const handleNext = () => scrollToPage(page + 1)

	const timeoutRef = useRef<NodeJS.Timeout | null>(null)
	useEffect(() => {
		const el = scrollContainer.current

		const handleScroll: EventListener = () => {
			timeoutRef.current && clearTimeout(timeoutRef.current)
			timeoutRef.current = setTimeout(() => {
				if (!scrollingWithCode) {
					setPage(index)
				}
				setScrollingWithCode(false)
			}, 200)

			console.log('scroll')
			if (scrollingWithCode) return
			if (!el) return
			const index = Math.round(el.scrollLeft / el.clientWidth)
			setPage(index)
			console.log(el.scrollLeft, el.clientWidth)
		}

		// scrollend doesn't work as well here
		el?.addEventListener('scroll', handleScroll)

		return () => el?.removeEventListener('scroll', handleScroll)
	}, [scrollingWithCode])

	return {
		scrollContainer,
		page,
		pageCount,
		toPage: scrollToPage,
		nextPage: handleNext,
		nextPageDisabled: page >= pageCount - 1,
		prevPage: handlePrev,
		prevPageDisabled: page <= 0,
	}
}

export function Page({index, children, className}: {index: number; children: React.ReactNode; className?: string}) {
	return (
		<div {...{[DATA_INDEX_ATTR]: index}} className={cn('relative h-full w-full flex-none snap-center', className)}>
			{/* <div className="absolute top-0 left-0">{index}</div> */}
			{children}
		</div>
	)
}

export function ArrowButton({
	direction,
	disabled,
	onClick,
}: {
	direction: 'left' | 'right'
	disabled?: boolean
	onClick?: () => void
}) {
	return (
		<button className={cn(glassButtonCva(), disabled && 'pointer-events-none')} onClick={onClick} disabled={disabled}>
			<CaretRight className={cn(direction === 'left' && 'rotate-180')} />
		</button>
	)
}

const glassButtonCva = cva(
	'shrink-0 w-10 h-10 rounded-full backdrop-blur-sm contrast-more:bg-neutral-800 contrast-more:backdrop-blur-none grid place-items-center bg-white/5 shadow-glass-button text-white/75 disabled:text-white/30 transition-all hover:bg-white/10 contrast-more:hover:bg-neutral-700 active:bg-white/5 cursor-default',
)

// ---

function PaginatorPill({active, onClick}: {active?: boolean; onClick: () => void}) {
	return (
		// Adding padding and negative margin to make click target bigger
		<button
			onClick={onClick}
			// z-10 to make sure it's above peer elements so click target is bigger
			className={cn('group z-10 -my-3 py-3', active && 'pointer-events-none')}
		>
			<div
				className={cn(
					'h-1 w-3 rounded-full bg-white/20 transition-all group-hover:bg-white/30',
					active && 'w-5 bg-white',
				)}
			/>
		</button>
	)
}

export function PaginatorPills({
	total,
	current,
	onCurrentChange,
}: {
	total: number
	current: number
	onCurrentChange: (page: number) => void
}) {
	return (
		<div className={cn('flex gap-1', total === 1 && 'invisible')}>
			{Array.from({length: total}).map((_, i) => (
				<PaginatorPill onClick={() => onCurrentChange(i)} key={i} active={i === current} />
			))}
		</div>
	)
}
