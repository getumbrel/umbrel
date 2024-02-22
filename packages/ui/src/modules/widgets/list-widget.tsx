
import { LOADING_DASH } from '@/constants'

import { ListWidget } from '@/modules/widgets/shared/constants'
import { WidgetContainer } from './shared/shared'

export function ListWidget({
	items,
	link,
	onClick,
}: {
	items?: ListWidget['items']
	link?: string
	onClick?: (link?: string) => void
}) {
	return (
		<WidgetContainer onClick={() => onClick?.(link)} className='cursor-pointer p-2 md:p-4'>
			<div
				className='flex h-full flex-col gap-2 max-sm:gap-0'
				style={{
					maskImage: 'linear-gradient(to bottom, red 50px calc(100% - 50px), transparent)',
				}}
			>
				{!items && <ListItem textSub={undefined} text={LOADING_DASH} />}
				{items?.map((item, i) => (
					<>
						{i !== 0 && <hr className='border-white/5' />}
						<ListItem key={i} textSub={item.textSub} text={item.text} />
					</>
				))}
			</div>
		</WidgetContainer>
	)
}

function ListItem({textSub, text}: {textSub?: string; text?: string}) {
	return (
		<div className='text-12 leading-tight'>
			<div className='truncate opacity-20'>{textSub ?? LOADING_DASH}</div>
			<p className='line-clamp-2 text-11 opacity-80 md:text-12'>{text}</p>
		</div>
	)
}
