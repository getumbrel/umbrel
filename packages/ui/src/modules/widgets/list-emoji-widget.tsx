import {take} from 'remeda'

import {LOADING_DASH} from '@/constants'
import {cn} from '@/lib/utils'
import type {ListEmojiItem, ListEmojiWidgetProps} from '@/modules/widgets/shared/constants'

import {compactContainerClass, WidgetShell} from './shared/widget-shell'

// Emoji rows over the count. The count sits in its own space at the bottom
// instead of under the rows, so a long name can't run beneath it.
export function ListEmojiWidget({
	items,
	count,
	link,
	onClick,
}: ListEmojiWidgetProps & {
	onClick?: (link?: string) => void
}) {
	// Older rows recede
	const fades = ['opacity-100', 'opacity-70', 'opacity-45']
	return (
		<WidgetShell
			onClick={() => onClick?.(link)}
			compact={<Compact items={items} count={count} />}
			className='gap-1 p-3 w-tall:gap-1.5 w-tall:p-4 w-expanded:p-5'
		>
			{(items ?? [loadingItem]).slice(0, 3).map((item, i) => (
				<div key={i} className={cn('flex min-w-0 items-center gap-1.5', fades[i])}>
					<span className='w-4 shrink-0 text-center text-12 leading-none w-expanded:w-5 w-expanded:text-15'>
						{limitToOneEmoji(item.emoji ?? '')}
					</span>
					<span className='min-w-0 truncate text-12 leading-tight font-semibold -tracking-2 opacity-85 w-expanded:text-13'>
						{item.text}
					</span>
				</div>
			))}
			<div className='flex-1' />
			<p className='max-w-full self-end truncate text-24 leading-none font-semibold -tracking-3 tabular-nums opacity-20 w-expanded:text-[33px]'>
				{count ?? LOADING_DASH}
			</p>
		</WidgetShell>
	)
}

// Three rows, one line each, over the count
function Compact({items, count}: ListEmojiWidgetProps) {
	const fades = ['opacity-100', 'opacity-70', 'opacity-40']
	return (
		<div className={cn(compactContainerClass, 'gap-1.5')}>
			{(items ? take(items, 3) : [loadingItem]).map((item, i) => (
				<div key={i} className={cn('flex min-w-0 items-center gap-1', fades[i])}>
					<span className='w-3.5 shrink-0 text-center text-12 leading-none'>{limitToOneEmoji(item.emoji ?? '')}</span>
					<span className='min-w-0 truncate text-11 leading-tight font-semibold text-white/80'>{item.text}</span>
				</div>
			))}
			<div className='flex-1' />
			<div className='max-w-full self-end truncate text-15 leading-none font-semibold -tracking-3 tabular-nums opacity-30'>
				{count ?? LOADING_DASH}
			</div>
		</div>
	)
}

const loadingItem: ListEmojiItem = {emoji: '', text: LOADING_DASH}

function limitToOneEmoji(str: string) {
	const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu
	const matchedEmojis = str.match(emojiRegex)
	return matchedEmojis ? matchedEmojis[0] : ''
}
