import {WidgetContainer, widgetTextCva} from './shared/shared'

export function ActionsWidget({
	actions,
	count,
	onClick,
}: {
	actions?: {
		emoji?: string
		title: string
	}[]
	count?: number
	onClick?: () => void
}) {
	return (
		<WidgetContainer onClick={onClick} className='relative gap-0 p-2 pb-2.5 md:gap-2 md:p-5'>
			{actions?.[0] && <ActionItem emoji={actions?.[0].emoji} title={actions?.[0].title} />}
			{actions?.[1] && (
				<div className='origin-left scale-90 opacity-60'>
					<ActionItem emoji={actions?.[1].emoji} title={actions?.[1].title} />
				</div>
			)}
			{actions?.[2] && (
				<div className='origin-left scale-[.8] opacity-40'>
					<ActionItem emoji={actions?.[2].emoji} title={actions?.[2].title} />
				</div>
			)}
			{actions?.[3] && (
				<div className='origin-left scale-[.7] opacity-20'>
					<ActionItem emoji={actions?.[3].emoji} title={actions?.[3].title} />
				</div>
			)}
			<div className='absolute bottom-3 right-3 text-[33px] font-semibold leading-none -tracking-3 opacity-10'>
				{count && count > 999 ? '999+' : count}
			</div>
		</WidgetContainer>
	)
}

function ActionItem({emoji, title}: {emoji?: string; title?: string}) {
	return (
		<div className='flex items-center gap-1.5'>
			<div className='flex h-5 w-5 items-center justify-center rounded-5 bg-white/5'>
				{limitToOneEmoji(emoji ?? '')}
			</div>
			<p className={widgetTextCva()}>{title}</p>
		</div>
	)
}

function limitToOneEmoji(str: string) {
	const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu
	const matchedEmojis = str.match(emojiRegex)
	return matchedEmojis ? matchedEmojis[0] : ''
}
