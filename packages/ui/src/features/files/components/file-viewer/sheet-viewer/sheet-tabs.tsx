import {useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {floatingGlassClass} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {cn} from '@/lib/utils'

// A workbook's sheets, floating over the bottom of the grid: one pill each,
// the one in view filled, and kept in view as the row scrolls on a phone
export function SheetTabs({
	sheets,
	active,
	onSelect,
}: {
	sheets: Array<{index: number; name: string}>
	active: number
	onSelect: (index: number) => void
}) {
	const {t} = useTranslation()
	const stripRef = useRef<HTMLDivElement>(null)
	const activeRef = useRef<HTMLButtonElement>(null)
	// Which ends have more tabs past them, faded out to say so
	const [more, setMore] = useState<'start' | 'end' | 'both'>()
	const measure = () => {
		const strip = stripRef.current
		if (!strip) return
		const start = strip.scrollLeft > 1
		const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
		setMore(start && end ? 'both' : start ? 'start' : end ? 'end' : undefined)
	}
	useLayoutEffect(() => {
		activeRef.current?.scrollIntoView({block: 'nearest', inline: 'nearest'})
	}, [active])
	useLayoutEffect(measure)
	useLayoutEffect(() => {
		const observer = new ResizeObserver(measure)
		observer.observe(stripRef.current!)
		return () => observer.disconnect()
	}, [])
	return (
		<div className='pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4'>
			<div className={cn(floatingGlassClass, 'pointer-events-auto flex h-10 max-w-full rounded-full p-1')}>
				<div
					ref={stripRef}
					role='tablist'
					aria-label={t('files-sheet.sheets-label')}
					onScroll={measure}
					// A mouse's wheel turns the strip, which only scrolls sideways
					onWheel={(event) => {
						if (event.deltaX || event.shiftKey) return
						const strip = event.currentTarget
						strip.scrollLeft +=
							event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? strip.clientWidth : 1)
					}}
					// The arrows go along the tabs, the one in view being the strip's place in the tab order
					onKeyDown={(event) => {
						const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')]
						const at = tabs.indexOf(event.target as HTMLElement)
						const {key} = event
						const to =
							key === 'ArrowRight'
								? at + 1
								: key === 'ArrowLeft'
									? at - 1
									: key === 'Home'
										? 0
										: key === 'End'
											? tabs.length - 1
											: undefined
						if (at < 0 || to === undefined) return
						// Not the viewer's, whose arrows go to the next file in quick look
						event.preventDefault()
						event.stopPropagation()
						tabs[(to + tabs.length) % tabs.length].focus()
					}}
					data-more={more}
					className={cn(
						'flex items-center gap-1 overflow-x-auto rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
						'data-[more=start]:[mask-image:linear-gradient(to_right,transparent,black_24px)]',
						'data-[more=end]:[mask-image:linear-gradient(to_left,transparent,black_24px)]',
						'data-[more=both]:[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]',
					)}
				>
					{sheets.map(({index, name}) => (
						<button
							key={index}
							ref={index === active ? activeRef : undefined}
							type='button'
							role='tab'
							aria-selected={index === active}
							tabIndex={index === active ? 0 : -1}
							// The whole name, which a long one is cut short of
							title={name}
							onClick={() => onSelect(index)}
							className={cn(
								'h-8 max-w-56 shrink-0 truncate rounded-full px-3.5 text-13 font-medium -tracking-2 transition-[background-color,color] duration-200 focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-hidden focus-visible:ring-inset',
								index === active
									? 'bg-white/20 text-white'
									: 'text-white/65 hover:bg-white/10 hover:text-white focus-visible:bg-white/10',
							)}
						>
							{name}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}
