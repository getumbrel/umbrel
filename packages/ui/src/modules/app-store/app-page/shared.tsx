import {useEffect, useRef, useState} from 'react'

import {Markdown} from '@/components/markdown'
import {cardFaintClass} from '@/modules/app-store/shared'
import {cn} from '@/shadcn-lib/utils'
import {linkClass} from '@/utils/element-classes'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export function ReadMoreMarkdownSection({children}: {children: string}) {
	const contentRef = useRef<HTMLDivElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)

	const [showReadMore, setShowReadMore] = useState(false)
	const [isExpanded, setIsExpanded] = useState(false)

	const toggle = () => {
		setIsExpanded((prev) => !prev)
		buttonRef.current?.focus()
	}

	useEffect(() => {
		if (!contentRef.current) return
		const el = contentRef.current
		/** If the available space is close to not enough, we don't collapse */
		const WIGGLE_ROOM = 20
		setShowReadMore(el.scrollHeight > el.clientHeight + WIGGLE_ROOM)

		const handleFocus = () => setIsExpanded(true)
		el.addEventListener('focusin', handleFocus)
		return () => {
			el.removeEventListener('focusin', handleFocus)
		}
	}, [children])

	return (
		<>
			<div
				ref={contentRef}
				style={{
					WebkitMaskImage:
						isExpanded || !showReadMore ? undefined : `linear-gradient(to bottom, black, black, transparent)`,
					// background: 'red',
				}}
				onClick={!isExpanded ? toggle : undefined}
				className={cn(
					cardTextClass,
					'transition-[max-height] duration-200',
					isExpanded || !showReadMore ? 'max-h-[9999px]' : 'max-h-[calc(1.7em*6)] overflow-hidden',
				)}
			>
				<Markdown>{children}</Markdown>
			</div>
			{showReadMore && (
				<button
					ref={buttonRef}
					onClick={toggle}
					className={cn(linkClass, 'self-start text-13 font-medium group-hover:text-brand')}
				>
					{isExpanded ? t('read-less') : t('read-more')}
				</button>
			)}
		</>
	)
}

export const appPageWrapperClass = tw`flex flex-col gap-8`
export const cardClass = cn(cardFaintClass, tw`rounded-12 px-[20px] py-[30px] flex flex-col gap-5`)
export const cardTitleClass = tw`text-12 opacity-50 uppercase leading-inter-trim font-semibold tracking-normal`
export const cardTextClass = tw`text-15 leading-snug`
