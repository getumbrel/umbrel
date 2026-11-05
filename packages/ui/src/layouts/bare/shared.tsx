import {motion} from 'motion/react'
import {HTMLProps} from 'react'

import UmbrelLogo from '@/components/umbrel-logo'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

export const UmbrelLogoLarge = () => (
	<UmbrelLogo className='w-[100px] opacity-85' style={{viewTransitionName: 'umbrel-logo'}} />
)

export function Title({children, className}: {children: React.ReactNode; className?: string}) {
	return (
		<h1
			className={cn(
				'text-center text-[24px] leading-tight font-bold -tracking-2 text-balance opacity-85 sm:text-[32px]',
				className,
			)}
			style={{
				viewTransitionName: 'title',
				textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)',
			}}
		>
			{children}
		</h1>
	)
}

export function SubTitle({
	children,
	className,
	...props
}: {
	children: React.ReactNode
	className?: string
} & HTMLProps<HTMLParagraphElement>) {
	return (
		<p className={cn('text-center text-[15px] font-medium text-balance text-white/70', className)} {...props}>
			{children}
		</p>
	)
}

export const footerClass = tw`flex items-center justify-center gap-4`
export const footerLinkClass = tw`text-13 transition-colors font-normal text-white/60 -tracking-3 hover:text-white/80 focus:outline-hidden focus-visible:ring-3`

export const buttonClass = tw`flex h-[42px] items-center rounded-full bg-white/75 px-4 text-14 font-medium -tracking-1 text-black ring-white/40 transition-all duration-300 hover:bg-white/85 focus:outline-hidden focus-visible:ring-3 active:scale-100 active:bg-white/90 min-w-[112px] justify-center disabled:pointer-events-none disabled:opacity-50`
export const primaryButtonProps = {
	className: buttonClass,
	style: {boxShadow: '0px 2px 4px 0px #FFFFFF inset'},
} as const
export const secondaryButtonClasss = tw`flex h-[42px] items-center rounded-full bg-neutral-600/40 backdrop-blur-xs px-4 text-14 font-medium -tracking-1 text-white ring-white/40 transition-all duration-300 hover:bg-neutral-600/60 focus:outline-hidden focus-visible:ring-3 active:scale-100 active:bg-neutral-600/60 min-w-[112px] justify-center disabled:pointer-events-none disabled:opacity-50`

export const formGroupClass = tw`flex w-full max-w-sm flex-col gap-2.5`

// Think of it as a helper component to make it easier to be consistent between pages. It's a brittle abtraction that
// shouldn't be taken too far.
export function Layout({
	title,
	titleClassName,
	subTitle,
	subTitleMaxWidth,
	subTitleClassName,
	children,
	footer,
	animate,
	showLogo = true,
}: {
	title: string
	titleClassName?: string
	subTitle: React.ReactNode
	subTitleMaxWidth?: number
	subTitleClassName?: string
	children: React.ReactNode
	footer?: React.ReactNode
	animate?: boolean
	/** Hide logo when showing device image */
	showLogo?: boolean
}) {
	// Entrance choreography (first arrival only): logo → title → content rise
	// in one after another once the card has settled, then the footer follows.
	const footerAnimationProps = animate
		? ({
				initial: {opacity: 0, y: 10},
				animate: {opacity: 1, y: 0},
				transition: {
					duration: 1,
					delay: 1.4,
					ease: ENTRANCE_EASE,
				},
			} as const)
		: ({} as const)
	return (
		<>
			{/* TODO: probably want consumer to set the title */}
			<div className='flex-1' />
			{/* mt keeps a minimum gap from the card's top edge when the spacers collapse */}
			<motion.div
				className='mt-5 flex w-full flex-col items-center gap-5'
				variants={entranceStagger}
				initial={animate ? 'hidden' : false}
				animate='show'
			>
				{showLogo && (
					<motion.div variants={entranceItem}>
						<UmbrelLogoLarge />
					</motion.div>
				)}
				<motion.div variants={entranceItem} className='flex flex-col items-center gap-1.5'>
					<Title className={titleClassName}>{title}</Title>
					<SubTitle className={subTitleClassName} style={{maxWidth: subTitleMaxWidth}}>
						{subTitle}
					</SubTitle>
				</motion.div>
				<motion.div variants={entranceItem} className='flex w-full flex-col items-center gap-5'>
					{children}
				</motion.div>
			</motion.div>
			<div className='flex-1' />
			{/* mt keeps a minimum gap to the content above when the card is full and the
			    flex-1 spacers collapse (e.g. the Pi drive choice screen on mobile) */}
			<motion.div className={cn(footerClass, 'mt-5')} {...footerAnimationProps}>
				{footer}
			</motion.div>
		</>
	)
}

const ENTRANCE_EASE = [0.16, 1, 0.3, 1] as const

const entranceStagger = {
	hidden: {},
	show: {transition: {delayChildren: 0.7, staggerChildren: 0.12}},
}

const entranceItem = {
	hidden: {opacity: 0, y: 12},
	show: {opacity: 1, y: 0, transition: {duration: 1.1, ease: ENTRANCE_EASE}},
}
