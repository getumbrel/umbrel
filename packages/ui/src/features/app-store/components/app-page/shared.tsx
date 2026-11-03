import {motion} from 'motion/react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Markdown} from '@/components/markdown'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// The store's standard expand/collapse: height animated on the sheet's
// morph curve (see components/ui/shared/motion.ts)
export const expandTransition = {duration: 0.35, ease: [0.32, 0.72, 0, 1]} as const

export const appPageWrapperClass = tw`flex flex-col gap-6 md:gap-8`
// Muted little label above an uncarded page section (timeline, credentials…)
export const appPageSectionLabelClass = tw`text-13 leading-inter-trimmed font-medium text-white/50`
export const appPageTextClass = tw`text-15 leading-relaxed break-words text-white/85`

export function ReadMoreMarkdownSection({
	children,
	lines = 6,
	className,
}: {
	children: string
	/** How many text lines stay visible while collapsed */
	lines?: number
	/** Styles the text itself: on a wrapper, Markdown's own prose styles would win */
	className?: string
}) {
	const {t} = useTranslation()
	const innerRef = useRef<HTMLDivElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)

	const [clampedHeight, setClampedHeight] = useState<number | null>(null)
	const [isOverflowing, setIsOverflowing] = useState(false)
	const [isExpanded, setIsExpanded] = useState(false)
	// The first commits (mount + pre-paint measurement) must not animate
	const mounted = useRef(false)
	useEffect(() => {
		mounted.current = true
	}, [])

	const toggle = () => {
		setIsExpanded((prev) => !prev)
		buttonRef.current?.focus()
	}

	// The clamp height comes from the real line height (the collapse cut lands
	// between lines), and overflow from the unclamped inner content's height
	useLayoutEffect(() => {
		const inner = innerRef.current
		if (!inner) return
		/** If the available space is close to enough, don't collapse */
		const WIGGLE_ROOM = 20
		const measure = () => {
			const text = inner.firstElementChild ?? inner
			const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 24
			setClampedHeight(Math.round(lineHeight * lines))
			setIsOverflowing(inner.offsetHeight > lineHeight * lines + WIGGLE_ROOM)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(inner)

		// Keyboard focus into masked content (links) reveals the rest
		const handleFocus = () => setIsExpanded(true)
		inner.addEventListener('focusin', handleFocus)
		return () => {
			observer.disconnect()
			inner.removeEventListener('focusin', handleFocus)
		}
	}, [children, lines])

	const collapsed = isOverflowing && !isExpanded

	return (
		<>
			<motion.div
				initial={false}
				animate={{height: collapsed && clampedHeight !== null ? clampedHeight : 'auto'}}
				transition={mounted.current ? expandTransition : {duration: 0}}
				style={{
					// The last couple of visible lines melt out instead of cutting off.
					// A short clamp fades only its lower half, so its first line stays crisp.
					WebkitMaskImage: collapsed
						? 'linear-gradient(to bottom, black calc(100% - min(3.5em, 50%)), transparent)'
						: undefined,
				}}
				onClick={collapsed ? toggle : undefined}
				className={cn(appPageTextClass, 'overflow-hidden')}
			>
				<div ref={innerRef}>
					<Markdown className={className}>{children}</Markdown>
				</div>
			</motion.div>
			{isOverflowing && (
				<button
					ref={buttonRef}
					onClick={toggle}
					className='self-start text-13 font-medium text-white/50 outline-hidden transition-colors hover:text-white focus-visible:text-white'
				>
					{isExpanded ? t('read-less') : t('read-more')}
				</button>
			)}
		</>
	)
}
