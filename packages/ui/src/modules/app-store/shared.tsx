import {ReactNode} from 'react'

import {SheetDescription, SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export const slideInFromBottomClass = tw`animate-in fade-in slide-in-from-bottom-8`
export const slideInFromBottomDelayedClass = tw`animate-in fade-in slide-in-from-bottom-8 fill-mode-both delay-200 `

const cardBaseClass = tw`rounded-20 md:px-[26px] md:py-[36px]`
export const cardClass = cn(cardBaseClass, tw`bg-gradient-to-b from-[#24242499] to-[#18181899]`)
export const cardFaintClass = cn(cardBaseClass, tw`bg-white/4`)

export const appsGridClass = tw`grid gap-x-5 md:gap-y-5 sm:grid-cols-2 xl:grid-cols-3`
export const sectionOverlineClass = tw`text-12 font-bold uppercase leading-tight opacity-50 md:text-15 mt-1 mb-1.5 md:mb-2 md:my-0`
export const sectionTitleClass = tw`text-18 font-bold leading-tight md:text-32 md:mb-4`

export function SectionTitle({overline, title}: {overline: string; title: ReactNode}) {
	return (
		<div className='p-2.5'>
			<p className={sectionOverlineClass}>{overline}</p>
			<h3 className={sectionTitleClass}>{title}</h3>
		</div>
	)
}

export function AppStoreSheetInner({
	children,
	beforeHeaderChildren,
	titleRightChildren,
	title,
	description,
}: {
	children: ReactNode
	beforeHeaderChildren?: ReactNode
	titleRightChildren?: ReactNode
	title: string
	description: ReactNode
}) {
	return (
		<div className='flex flex-col gap-5 md:gap-8'>
			{beforeHeaderChildren}
			<SheetHeader className='gap-5'>
				<div className='flex flex-wrap items-center gap-x-5 gap-y-5 px-2.5 md:px-0'>
					<SheetTitle className='flex-1 whitespace-nowrap capitalize leading-none'>{title}</SheetTitle>
					{titleRightChildren}
				</div>
				<SheetDescription className='hidden items-center justify-between text-left text-17 font-medium -tracking-2 text-white/75 md:flex'>
					{description}
				</SheetDescription>
			</SheetHeader>
			{children}
		</div>
	)
}
