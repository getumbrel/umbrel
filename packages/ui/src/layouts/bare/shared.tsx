import {motion} from 'motion/react'
import {HTMLProps} from 'react'

import UmbrelLogo from '@/assets/umbrel-logo'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export const UmbrelLogoLarge = () => (
	<UmbrelLogo className='w-[100px] opacity-85' style={{viewTransitionName: 'umbrel-logo'}} />
)

export function Title({children}: {children: React.ReactNode}) {
	return (
		<h1
			className='text-center text-[32px] leading-tight font-bold -tracking-2 opacity-85'
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
		<p className={cn('text-center text-[15px] font-medium text-white/70', className)} {...props}>
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
	subTitle,
	subTitleMaxWidth,
	subTitleClassName,
	children,
	footer,
	animate,
	showLogo = true,
}: {
	title: string
	subTitle: React.ReactNode
	subTitleMaxWidth?: number
	subTitleClassName?: string
	children: React.ReactNode
	footer?: React.ReactNode
	animate?: boolean
	/** Hide logo when showing device image */
	showLogo?: boolean
}) {
	const footerAnimationProps = animate
		? ({
				initial: {opacity: 0, x: -60, y: -40},
				animate: {opacity: 1, x: 0, y: 0},
				transition: {
					duration: 2.5,
					delay: 1.5,
					ease: [0.16, 1, 0.3, 1],
				},
			} as const)
		: ({} as const)
	return (
		<>
			{/* TODO: probably want consumer to set the title */}
			<div className='flex-1' />
			<div className='flex w-full flex-col items-center gap-5'>
				{showLogo && <UmbrelLogoLarge />}
				<div className='flex flex-col items-center gap-1.5'>
					<Title>{title}</Title>
					<SubTitle className={subTitleClassName} style={{maxWidth: subTitleMaxWidth}}>
						{subTitle}
					</SubTitle>
				</div>
				{children}
			</div>
			<div className='flex-1' />
			<motion.div className={footerClass} {...footerAnimationProps}>
				{footer}
			</motion.div>
		</>
	)
}
