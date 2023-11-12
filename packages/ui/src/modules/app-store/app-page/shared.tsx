import {CSSProperties, ReactNode, useState} from 'react'

import {cardFaintClass} from '@/modules/app-store/shared'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export function ReadMoreSection({children, lines = 6}: {children: ReactNode; lines: number}) {
	const [isExpanded, setIsExpanded] = useState(false)

	const toggle = () => setIsExpanded((prev) => !prev)

	return (
		<>
			<p className={cn(cardTextClass)} style={isExpanded ? undefined : lineClampStyles(lines)}>
				{children}
			</p>
			<button onClick={toggle} className='self-start text-13 font-medium text-brand-lighter'>
				{isExpanded ? 'Read less' : 'Read more'}
			</button>
		</>
	)
}

// Stolen from tailwind EX: `line-clamp-3`
function lineClampStyles(lines: number): CSSProperties {
	return {
		overflow: 'hidden',
		display: '-webkit-box',
		WebkitBoxOrient: 'vertical',
		WebkitLineClamp: lines,
	}
}

export const cardClass = cn(cardFaintClass, tw`rounded-12 flex flex-col gap-5`)
export const cardTitleClass = tw`text-12 opacity-50 uppercase leading-tight font-semibold tracking-normal`
export const cardTextClass = tw`text-15 leading-snug whitespace-pre-wrap`
