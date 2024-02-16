import {useState} from 'react'

import {Markdown} from '@/components/markdown'
import {cardFaintClass} from '@/modules/app-store/shared'
import {cn} from '@/shadcn-lib/utils'
import {linkClass} from '@/utils/element-classes'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export function ReadMoreMarkdownSection({children, collapseClassName}: {children: string; collapseClassName: string}) {
	const [isExpanded, setIsExpanded] = useState(false)

	const toggle = () => setIsExpanded((prev) => !prev)

	return (
		<>
			<Markdown className={cn(cardTextClass, !isExpanded && collapseClassName)}>{children}</Markdown>
			<button onClick={toggle} className={cn(linkClass, 'self-start text-13 font-medium group-hover:text-brand')}>
				{isExpanded ? t('read-less') : t('read-more')}
			</button>
		</>
	)
}

export const appPageWrapperClass = tw`flex flex-col gap-5 md:gap-[40px]`
export const cardClass = cn(cardFaintClass, tw`rounded-12 px-[20px] py-[30px] flex flex-col gap-5`)
export const cardTitleClass = tw`text-12 opacity-50 uppercase leading-inter-trim font-semibold tracking-normal`
export const cardTextClass = tw`text-15 leading-snug`
