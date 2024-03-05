
import { LOADING_DASH } from '@/constants'

import { ListWidget } from '@/modules/widgets/shared/constants'
import { WidgetContainer } from './shared/shared'
import { Fragment } from 'react'

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
		<WidgetContainer onClick={() => onClick?.(link)} className='cursor-pointer p-2 !pb-0 md:p-4 overflow-hidden'>
			<div
				className='flex h-full flex-col gap-2 max-sm:gap-0'
				style={{
					maskImage: 'linear-gradient(to bottom, red 50px calc(100% - 80px), transparent)',
				}}
			>
				{!items && <ListItem textSub={undefined} text={LOADING_DASH} />}
				{/* Slice just in case API sends down too much data */}
				{items?.slice(0, 5)?.map((item, i) => (
					<Fragment key={i}>
						{i !== 0 && <hr className='border-white/5' />}
						<ListItem textSub={item.textSub} text={item.text} />
					</Fragment>
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
