import {ReactNode} from 'react'

import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export const slideInFromBottomClass = tw`animate-in fade-in slide-in-from-bottom-8`

const cardBaseClass = tw`rounded-20 px-[30px] py-[40px]`
export const cardClass = cn(cardBaseClass, tw`bg-gradient-to-b from-[#24242499] to-[#18181899]`)
export const cardFaintClass = cn(cardBaseClass, tw`bg-white/4`)

export const appsGridClass = tw`grid gap-x-5 gap-y-[40px] sm:grid-cols-2 lg:grid-cols-3`
export const sectionTitleClass = tw`mb-[40px] text-24 font-bold leading-tight md:text-32`

export function SectionTitle({overline, title}: {overline: string; title: ReactNode}) {
	return (
		<div>
			<p className='text-12 font-bold uppercase leading-tight opacity-50 md:text-15'>{overline}</p>
			<h3 className={sectionTitleClass}>{title}</h3>
		</div>
	)
}
