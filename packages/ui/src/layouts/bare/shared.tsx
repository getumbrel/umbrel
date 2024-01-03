import {HTMLProps} from 'react'

import UmbrelLogo from '@/assets/umbrel-logo'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export const UmbrelLogoLarge = () => <UmbrelLogo className='md:w-[120px]' />

export function Title({children, hasTransition}: {children: React.ReactNode; hasTransition: boolean}) {
	return (
		<h1
			className='text-center text-24 font-bold leading-tight -tracking-2 md:text-56'
			style={{
				viewTransitionName: hasTransition ? 'title' : undefined,
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
		<p className={cn('text-center font-medium leading-tight -tracking-2 opacity-50 md:text-19', className)} {...props}>
			{children}
		</p>
	)
}

export const footerClass = tw`flex items-center justify-center gap-4`
export const footerLinkClass = tw`text-13 transition-colors font-normal text-white/60 -tracking-3 hover:text-white/80 focus:outline-none focus-visible:ring-3`

export const buttonClass = tw`flex h-[42px] items-center rounded-full bg-white px-4 text-14 font-medium -tracking-1 text-black ring-white/40 transition-all duration-300 hover:bg-white/80 focus:outline-none focus-visible:ring-3 active:scale-100 active:bg-white/90 min-w-[112px] justify-center disabled:pointer-events-none disabled:opacity-50`

export const formGroupClass = tw`flex w-full max-w-sm flex-col gap-2.5`

// Think of it as a helper component to make it easier to be consistent between pages. It's a brittle abtraction that
// shouldn't be taken too far.
export function Layout({
	title,
	transitionTitle = true,
	subTitle,
	subTitleMaxWidth,
	children,
	footer,
}: {
	title: string
	transitionTitle?: boolean
	subTitle: React.ReactNode
	subTitleMaxWidth?: number
	children: React.ReactNode
	footer?: React.ReactNode
}) {
	return (
		<>
			<div className='flex-1' />
			<div className='flex flex-col items-center gap-5'>
				<UmbrelLogoLarge />
				<div className='flex flex-col items-center gap-1.5'>
					<Title hasTransition={transitionTitle}>{title}</Title>
					<SubTitle style={{maxWidth: subTitleMaxWidth}}>{subTitle}</SubTitle>
				</div>
				{children}
			</div>
			<div className='flex-1' />
			<div className='pt-5' />
			<div className={footerClass}>{footer}</div>
		</>
	)
}
