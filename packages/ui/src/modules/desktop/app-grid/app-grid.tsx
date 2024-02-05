import {AnimatePresence} from 'framer-motion'
import {ReactNode, useEffect, useState} from 'react'

import {tw} from '@/utils/tw'

import {AppGridGradientMasking} from '../desktop-misc'
import {usePager} from './app-pagination-utils'
import {ArrowButton, Page, PaginatorPills, usePaginator} from './paginator'

export function AppGrid({
	apps = [],
	widgets = [],
	onlyFirstPage = false,
}: {
	apps?: ReactNode[]
	widgets?: ReactNode[]
	onlyFirstPage?: boolean
}) {
	const {pageInnerRef, pages, appsPerRow} = usePager({apps, widgets})
	const [showMasking, setShowMasking] = useState(false)
	const pageCount = pages.length

	const {scrollContainer, page, toPage, nextPage, nextPageDisabled, prevPage, prevPageDisabled} =
		usePaginator(pageCount)

	const noRoom = apps.length > 0 && pages[0].apps.length === 0 && pages[0].widgets.length === 0

	const appColumnsStyle: React.CSSProperties = {
		gridTemplateColumns: `repeat(${appsPerRow}, minmax(0, 1fr))`,
	}

	// Hide and show gradient masking based on whether we're scrolling
	useEffect(() => {
		const el = scrollContainer.current
		if (!el) return
		const handleShowMasking = () => setShowMasking(true)
		const handleHideMasking = () => setShowMasking(false)

		el.addEventListener('scroll', handleShowMasking)
		el.addEventListener('scrollend', handleHideMasking)
		return () => {
			el?.removeEventListener('scroll', handleShowMasking)
			el?.removeEventListener('scrollend', handleHideMasking)
		}
	}, [scrollContainer])

	return (
		<div className='flex h-full w-full flex-grow flex-col items-center'>
			<div className='relative flex w-full flex-grow justify-center overflow-hidden'>
				<div
					ref={scrollContainer}
					className='umbrel-hide-scrollbar flex h-full w-full snap-x snap-mandatory overflow-hidden overflow-x-auto md:max-w-[var(--apps-max-w)]'
				>
					{/* Default page for calculating size */}
					<Page index={0}>
						<PageInner innerRef={pageInnerRef}>
							{noRoom && <div className='w-full text-center'>Not enough room to show anything.</div>}
							<AnimatePresence>
								{pages[0]?.widgets.length > 0 && <div className={widgetRowClass}>{pages[0].widgets}</div>}
								{pages[0]?.apps && pages[0]?.apps.length > 0 && (
									<div className={appGridClass} style={appColumnsStyle}>
										{/* TODO: use `appsPerRow` to split apps into separate rows */}
										{/* TODO: consider laying apps out manually */}
										{pages[0].apps}
									</div>
								)}
							</AnimatePresence>
						</PageInner>
					</Page>
					{!onlyFirstPage &&
						pages.slice(1).map(({apps, widgets}, i) => (
							<Page key={i} index={i + 1}>
								<PageInner>
									<AnimatePresence>
										{widgets.length > 0 && <div className={widgetRowClass}>{widgets}</div>}
										{apps && (
											<div className={appGridClass} style={appColumnsStyle}>
												{apps}
											</div>
										)}
									</AnimatePresence>
								</PageInner>
							</Page>
						))}
				</div>
				{pageCount > 1 && (
					<>
						<ArrowButtonWrapper side='left'>
							<ArrowButton direction='left' disabled={prevPageDisabled} onClick={prevPage} />
						</ArrowButtonWrapper>
						<ArrowButtonWrapper side='right'>
							<ArrowButton direction='right' disabled={nextPageDisabled} onClick={nextPage} />
						</ArrowButtonWrapper>
					</>
				)}
			</div>
			{showMasking && <AppGridGradientMasking />}
			{/* NOTE: always leave space for pills to avoid layout thrashing */}
			{/* Adding margin bottom so pills are clickable */}
			<div className='mb-6 mt-6'>
				<PaginatorPills total={pageCount} current={page} onCurrentChange={toPage} />
			</div>
		</div>
	)
}

function ArrowButtonWrapper({side, children}: {side: 'left' | 'right'; children: ReactNode}) {
	return (
		<div
			className='absolute top-1/2 z-10 hidden lg:block'
			style={{
				[side]: 'calc((100% - var(--page-w)) / 2 - var(--apps-padding-x))',
				transform: `translateX(${side === 'left' ? '-100%' : '100%'}) translateY(-50%)`,
			}}
		>
			{children}
		</div>
	)
}

export function PageInner({children, innerRef}: {children?: ReactNode; innerRef?: React.Ref<HTMLDivElement>}) {
	return (
		// Size the container to fill parent so we can later calculate what can fit inside it
		<div className='flex h-full w-full items-stretch justify-center'>
			<div
				ref={innerRef}
				className='flex w-full max-w-[var(--apps-max-w)] flex-col content-start items-center gap-y-[var(--app-y-gap)] px-[var(--apps-padding-x)]'
			>
				{children}
			</div>
		</div>
	)
}

const widgetRowClass = tw`flex gap-[var(--app-x-gap)] w-full justify-center`
const appGridClass = tw`gap-x-[var(--app-x-gap)] gap-y-[var(--app-y-gap)] grid content-center justify-center`
