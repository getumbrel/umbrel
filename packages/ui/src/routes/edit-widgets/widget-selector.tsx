import {Minus, Plus} from 'lucide-react'
import {animate, AnimatePresence, motion, useMotionValue, type PanInfo} from 'motion/react'
import {CSSProperties, ReactNode, useEffect, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {useMeasure} from 'react-use'
import {chunk} from 'remeda'

import {AppIcon} from '@/components/app-icon'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {ScrollArea} from '@/components/ui/sheet-scroll-area'
import {WidgetCheckIcon} from '@/components/widget-check-icon'
import {useWidgets} from '@/hooks/use-widgets'
import {cn} from '@/lib/utils'
import {ArrowButton, PaginatorPills} from '@/modules/desktop/app-grid/paginator'
import {DockSpacer} from '@/modules/desktop/dock'
import {useTuckDockOnScroll} from '@/modules/desktop/dock-tuck'
import {ExampleWidget, Widget} from '@/modules/widgets'
import {BackdropBlurVariantContext} from '@/modules/widgets/shared/backdrop-blur-context'
import {MAX_WIDGETS} from '@/modules/widgets/shared/constants'

const carouselSpring = {type: 'spring', stiffness: 400, damping: 40} as const

// Set on the document by Home's pager (usePager)
const widgetRowWidthStyle = {'--widget-w': 'var(--widget-row-w)'} as CSSProperties

// How many selected widgets fit per carousel page: as many as fit side by side in
// Home's widget row, which usePager publishes on documentElement. It publishes
// them only once the desktop grid has measured itself, and again as the window
// changes, so follow the document's style instead of reading it once.
function useWidgetsPerPage() {
	const [perPage, setPerPage] = useState(MAX_WIDGETS)
	useEffect(() => {
		const el = document.documentElement
		const read = () => {
			const fit = parseInt(el.style.getPropertyValue('--widgets-fit'))
			if (fit > 0) setPerPage(fit)
		}
		read()
		const observer = new MutationObserver(read)
		observer.observe(el, {attributeFilter: ['style']})
		return () => observer.disconnect()
	}, [])
	return perPage
}

export function WidgetSelector({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
	// Delay until after `usePager` has injected CSS vars
	const [isReady, setIsReady] = useState(false)
	useEffect(() => {
		const id = setTimeout(() => setIsReady(true), 300)
		return () => clearTimeout(id)
	}, [])

	const {availableWidgets, toggleSelected, selected, selectedTooMany} = useWidgets()

	// Selected widgets page like the homescreen's widget row instead of
	// overflowing a single row. The carousel is transform-driven (no scroll
	// container), so the widgets' glass shadows are never clipped — off-page
	// widgets fade out instead, and fade back in while dragging.
	// Under the MAX_WIDGETS cap that's one page wherever Home's row fits three
	// side by side, and two where it doesn't (a 320px phone).
	const widgetsPerPage = useWidgetsPerPage()
	const widgetPages = chunk(selected, widgetsPerPage)
	const pageCount = Math.max(1, widgetPages.length)
	const [page, setPage] = useState(0)
	const [dragging, setDragging] = useState(false)
	const [measureRef, {width: pageW}] = useMeasure<HTMLDivElement>()

	const x = useMotionValue(0)
	useEffect(() => {
		const controls = animate(x, -page * pageW, carouselSpring)
		return () => controls.stop()
	}, [page, pageW, x])

	const toPage = (index: number) => setPage(Math.max(0, Math.min(pageCount - 1, index)))

	const handleDragEnd = (_event: unknown, info: PanInfo) => {
		setDragging(false)
		// Land on the neighboring page when the drag traveled far or flicked fast
		const swipe = info.offset.x + info.velocity.x * 0.2
		let target = page
		if (swipe < -pageW / 3) target = page + 1
		else if (swipe > pageW / 3) target = page - 1
		target = Math.max(0, Math.min(pageCount - 1, target))
		setPage(target)
		// Same-page release still needs the spring back to the resting position
		animate(x, -target * pageW, carouselSpring)
	}

	// Adding a widget appends it to the end, so slide the carousel there to
	// show it
	const prevSelectedCount = useRef(selected.length)
	useEffect(() => {
		if (selected.length > prevSelectedCount.current) setPage(pageCount - 1)
		prevSelectedCount.current = selected.length
	}, [selected.length, pageCount])

	// Removing widgets can drop the last page out from under the current one
	useEffect(() => {
		setPage((current) => Math.min(current, pageCount - 1))
	}, [pageCount])

	if (!isReady) return null

	const selectedH = selected.length == 0 ? 'var(--sheet-top)' : `calc(var(--widget-h) + 8vh)`

	return (
		<>
			{open && (
				// `pointer-events-none` because we want clicking outside the sheet to close the sheet, not interact with the widget.
				// `overflow-x-clip` (at the screen edge, so shadows still flow freely over the visible strip): the carousel's
				// off-page widgets extend past the viewport, and without the clip that overflow widens a transformed ancestor —
				// which the sheet's `fixed` position resolves against, shoving it below the viewport on mobile
				<div className='pointer-events-none absolute inset-x-0 top-0 z-50 flex flex-col items-center overflow-x-clip'>
					{/* <div className='absoulte top-0 grid h-[var(--widget-h)] w-full place-items-center whitespace-nowrap'>
						No widgets selected
					</div> */}
					<motion.div
						initial={{
							opacity: 0,
							y: 40,
						}}
						animate={{
							opacity: 1,
							y: 0,
						}}
						transition={{
							duration: 0.2,
							ease: 'easeOut',
						}}
						className={cn('flex flex-col items-center justify-center gap-5', selectedTooMany && 'animate-shake')}
						style={{height: selectedH}}
					>
						{/* Same paged carousel as the homescreen's widget row: swipeable,
						   with arrows on lg+ and pills below. Transform-driven with no
						   overflow clipping so the widgets' glass shadows paint freely;
						   off-page widgets fade out and fade back in while dragging. The
						   widgets themselves stay click-through (they'd open their apps
						   otherwise). */}
						<div className='relative flex items-center'>
							{pageCount > 1 && (
								<div className='pointer-events-auto absolute top-1/2 -left-4 hidden -translate-x-full -translate-y-1/2 lg:block'>
									<ArrowButton direction='left' disabled={page <= 0} onClick={() => toPage(page - 1)} />
								</div>
							)}
							{/* Match the widget sheet's max width below. Widgets take the width they have in
							    Home's row, so three fit side by side wherever they do there */}
							<div ref={measureRef} className='w-screen max-w-[1040px]' style={widgetRowWidthStyle}>
								<motion.div
									className='pointer-events-auto flex'
									style={{x}}
									drag={pageCount > 1 ? 'x' : false}
									dragConstraints={{left: -(pageCount - 1) * pageW, right: 0}}
									dragElastic={0.12}
									dragMomentum={false}
									onDragStart={() => setDragging(true)}
									onDragEnd={handleDragEnd}
								>
									{widgetPages.map((pageWidgets, pageIndex) => (
										<motion.div
											key={pageIndex}
											animate={{opacity: dragging || pageIndex === page ? 1 : 0}}
											transition={{duration: 0.2}}
											className='pointer-events-none flex h-[var(--widget-h)] w-full flex-none items-center justify-center gap-[var(--app-x-gap)]'
										>
											<AnimatePresence>
												{pageWidgets.map((widget) => {
													return (
														<motion.div
															key={widget.id}
															layout
															initial={{
																opacity: 1,
																y: -20,
															}}
															animate={{
																opacity: 1,
																y: 0,
															}}
															exit={{
																opacity: 0,
																y: 20,
															}}
															transition={{
																type: 'spring',
																stiffness: 500,
																damping: 30,
															}}
														>
															<Widget appId={widget.app.id} config={widget} />
														</motion.div>
													)
												})}
											</AnimatePresence>
										</motion.div>
									))}
								</motion.div>
							</div>
							{pageCount > 1 && (
								<div className='pointer-events-auto absolute top-1/2 -right-4 hidden translate-x-full -translate-y-1/2 lg:block'>
									<ArrowButton direction='right' disabled={page >= pageCount - 1} onClick={() => toPage(page + 1)} />
								</div>
							)}
						</div>
						{pageCount > 1 && (
							<div className='pointer-events-auto'>
								<PaginatorPills total={pageCount} current={page} onCurrentChange={toPage} />
							</div>
						)}
					</motion.div>
				</div>
			)}
			<WidgetSheet open={open} onOpenChange={onOpenChange} selectedCssHeight={selectedH}>
				<div className='flex flex-col items-start gap-5 md:gap-8'>
					{availableWidgets.map(({appId, icon, name, widgets}) => {
						return (
							<WidgetSection key={appId} iconSrc={icon} title={name}>
								{widgets?.map((widget) => {
									return (
										<ErrorBoundary key={widget.id} fallback={null}>
											<WidgetChecker
												checked={selected.map((w) => w.id).includes(widget.id)}
												onCheckedChange={(checked) => toggleSelected(widget.id, checked)}
											>
												<ExampleWidget type={widget.type} example={widget.example} />
											</WidgetChecker>
										</ErrorBoundary>
									)
								})}
							</WidgetSection>
						)
					})}
				</div>
			</WidgetSheet>
		</>
	)
}

function WidgetSheet({
	open,
	onOpenChange,
	children,
	selectedCssHeight,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	children: ReactNode
	selectedCssHeight: string
}) {
	const {t} = useTranslation()
	// A phone on its side keeps a sliver of sheet under the widgets row, so the
	// dock steps out of the way as the widgets scroll
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
	useTuckDockOnScroll(scroller)
	return (
		<BackdropBlurVariantContext value='default'>
			<Sheet open={open} onOpenChange={onOpenChange} modal={false}>
				<SheetContent
					className='mx-auto max-w-[1040px] transition-[height]'
					onInteractOutside={(e) => e.preventDefault()}
					style={{
						height: `calc(100dvh - ${selectedCssHeight})`,
					}}
					backdrop={<div className='fixed inset-0 z-30' onClick={() => onOpenChange(false)} />}
				>
					<ScrollArea className='umbrel-window-surface-top h-full' viewportRef={setScroller}>
						<div
							className={cn(
								'flex h-full flex-col items-start gap-5 px-4 pt-6 opacity-0 md:gap-8 md:px-[80px] md:pt-12 low:gap-4 low:pt-4',
								'animate-in opacity-100 duration-100 fade-in',
							)}
						>
							<SheetHeader>
								<SheetTitle>{t('widgets.edit.select-up-to-3-widgets')}</SheetTitle>
							</SheetHeader>
							<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>{children}</ErrorBoundary>
							<DockSpacer />
						</div>
					</ScrollArea>
				</SheetContent>
			</Sheet>
		</BackdropBlurVariantContext>
	)
}

function WidgetSection({iconSrc, title, children}: {iconSrc: string; title: string; children: ReactNode}) {
	return (
		<>
			<div className='flex items-center gap-3'>
				<AppIcon src={iconSrc} size={36} className='rounded-8' />
				<h3 className='text-20 leading-tight font-semibold'>{title}</h3>
			</div>
			<div className='flex flex-row flex-wrap gap-[20px]'>{children}</div>
			<div className='h-1'></div>
		</>
	)
}

function PlusIcon({className}: {className?: string}) {
	return (
		<div className={cn('flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/80', className)}>
			<Plus className='h-4 w-4 text-black' strokeWidth={2.5} />
		</div>
	)
}

function MinusIcon({className}: {className?: string}) {
	return (
		<div className={cn('flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/80', className)}>
			<Minus className='h-4 w-4 text-black' strokeWidth={2.5} />
		</div>
	)
}

function WidgetChecker({
	children,
	checked = false,
	onCheckedChange,
}: {
	children: ReactNode
	checked?: boolean
	onCheckedChange?: (checked: boolean) => void
}) {
	return (
		<div className='group relative'>
			{children}
			{/* Corner icon: check when selected, plus/minus on hover to hint add/remove */}
			<div className='absolute top-0 right-0 translate-x-1/3 -translate-y-1/3'>
				{checked ? (
					<>
						{/* Show check by default, swap to minus on hover */}
						<div className='text-brand group-hover:hidden'>
							<WidgetCheckIcon className='max-sm:scale-75' />
						</div>
						<div className='hidden group-hover:block'>
							<MinusIcon className='max-sm:scale-75' />
						</div>
					</>
				) : (
					/* Fade in plus icon on hover */
					<div className='opacity-0 transition-opacity group-hover:opacity-100'>
						<PlusIcon className='max-sm:scale-75' />
					</div>
				)}
			</div>
			{/* Invisible overlay button for the entire widget area */}
			<button
				className='absolute top-0 left-0 h-full w-full rounded-12 outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:rounded-20'
				onClick={() => onCheckedChange?.(!checked)}
			/>
		</div>
	)
}
