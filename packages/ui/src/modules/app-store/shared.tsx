import {ReactNode} from 'react'

import {AppIcon} from '@/components/app-icon'
import {SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export const slideInFromBottomClass = tw`animate-in fade-in slide-in-from-bottom-8 duration-300`

const cardBaseClass = tw`rounded-20 px-2 py-2 md:px-[26px] md:py-[36px]`
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
}: {
	children: ReactNode
	beforeHeaderChildren?: ReactNode
	titleRightChildren?: ReactNode
	title: string
}) {
	return (
		<div className='flex flex-col gap-5 md:gap-8'>
			{beforeHeaderChildren}
			<SheetHeader className='gap-5'>
				<div className='flex flex-col gap-x-5 gap-y-5 px-2.5 md:flex-row md:items-center md:px-0'>
					<SheetTitle className='flex-1 whitespace-nowrap capitalize leading-none'>{title}</SheetTitle>
					{titleRightChildren}
				</div>
			</SheetHeader>
			{children}
		</div>
	)
}

export function AppWithName({
	icon,
	appName,
	childrenRight,
	className,
}: {
	icon: string
	appName: ReactNode
	childrenRight?: ReactNode
	className?: string
}) {
	return (
		<div className={cn('flex w-full items-center gap-2.5', className)}>
			<AppIcon src={icon} size={36} className='rounded-8' />
			<h3 className='flex-1 truncate text-14 font-semibold leading-tight -tracking-3'>{appName}</h3>
			{childrenRight}
		</div>
	)
}
