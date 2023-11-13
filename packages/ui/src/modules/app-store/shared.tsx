import {ReactNode} from 'react'

import {SheetDescription, SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export const slideInFromBottomClass = tw`animate-in fade-in slide-in-from-bottom-8`
export const slideInFromBottomDelayedClass = tw`animate-in fade-in slide-in-from-bottom-8 fill-mode-both delay-200 `

const cardBaseClass = tw`rounded-20 px-[30px] py-[40px]`
export const cardClass = cn(cardBaseClass, tw`bg-gradient-to-b from-[#24242499] to-[#18181899]`)
export const cardFaintClass = cn(cardBaseClass, tw`bg-white/4`)

export const appsGridClass = tw`grid gap-x-5 gap-y-[40px] sm:grid-cols-2 lg:grid-cols-3`
export const sectionTitleClass = tw`mb-[40px] text-24 font-bold leading-tight md:text-32`
export const sectionOverlineClass = tw`text-12 font-bold uppercase leading-tight opacity-50 md:text-15`

export function SectionTitle({overline, title}: {overline: string; title: ReactNode}) {
	return (
		<div>
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
		<div className='flex flex-col gap-8'>
			{beforeHeaderChildren}
			<SheetHeader className='gap-5'>
				<div className='flex flex-wrap-reverse items-center gap-y-2'>
					<SheetTitle className='text-48 capitalize leading-none'>{title}</SheetTitle>
					<div className='flex-1' />
					{titleRightChildren}
				</div>
				<SheetDescription className='flex items-center justify-between text-left text-17 font-medium -tracking-2 text-white/75'>
					{description}
				</SheetDescription>
			</SheetHeader>
			{children}
		</div>
	)
}
