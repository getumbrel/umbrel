import {LOADING_DASH} from '@/constants'
import type {ListEmojiItem, ListEmojiWidget, ListEmojiWidgetProps} from '@/modules/widgets/shared/constants'

import {WidgetContainer, widgetTextCva} from './shared/shared'

export function ListEmojiWidget({
	items,
	count,
	link,
	onClick,
}: ListEmojiWidgetProps & {
	onClick?: (link?: string) => void
}) {
	return (
		<WidgetContainer onClick={() => onClick?.(link)} className='relative gap-0 p-2 pb-2.5 md:gap-2 md:p-5'>
			{!items && <ListEmojiItem emoji='' text={LOADING_DASH} />}
			{items?.[0] && <ListEmojiItem emoji={items?.[0].emoji} text={items?.[0].text} />}
			{items?.[1] && (
				<div className='origin-left scale-90 opacity-60'>
					<ListEmojiItem emoji={items?.[1].emoji} text={items?.[1].text} />
				</div>
			)}
			{items?.[2] && (
				<div className='origin-left scale-[.8] opacity-40'>
					<ListEmojiItem emoji={items?.[2].emoji} text={items?.[2].text} />
				</div>
			)}
			{items?.[3] && (
				<div className='origin-left scale-[.7] opacity-20'>
					<ListEmojiItem emoji={items?.[3].emoji} text={items?.[3].text} />
				</div>
			)}
			<div className='absolute bottom-3 right-3 w-1/2 truncate text-right text-[33px] font-semibold leading-none -tracking-3 opacity-10'>
				{count ?? LOADING_DASH}
			</div>
		</WidgetContainer>
	)
}

function ListEmojiItem(item?: ListEmojiItem) {
	return (
		<div className='flex items-center gap-1.5'>
			<div className='flex h-5 w-5 items-center justify-center rounded-5 bg-white/5'>
				{limitToOneEmoji(item?.emoji ?? '')}
			</div>
			<p className={widgetTextCva()}>{item?.text}</p>
		</div>
	)
}

function limitToOneEmoji(str: string) {
	const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu
	const matchedEmojis = str.match(emojiRegex)
	return matchedEmojis ? matchedEmojis[0] : ''
}
