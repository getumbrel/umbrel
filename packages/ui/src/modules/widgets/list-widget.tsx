import {Fragment} from 'react'

import {LOADING_DASH} from '@/constants'
import type {ListWidget, ListWidgetItem, ListWidgetProps} from '@/modules/widgets/shared/constants'

import {WidgetContainer} from './shared/shared'

export function ListWidget({
	items,
	link,
	noItemsText = 'Nothing to show.',
	onClick,
}: ListWidgetProps & {
	onClick?: (link?: string) => void
}) {
	return (
		<WidgetContainer onClick={() => onClick?.(link)} className='cursor-pointer overflow-hidden p-2 !pb-0 md:p-4'>
			<div
				className='flex h-full w-full flex-col gap-2 max-sm:gap-0'
				style={{
					maskImage: 'linear-gradient(to bottom, red 50px calc(100% - 80px), transparent)',
				}}
			>
				{!items && <ListItem subtext={undefined} text={LOADING_DASH} />}
				{items?.length === 0 && (
					<div className='grid h-full w-full place-items-center pb-2 text-center md:pb-4'>{noItemsText}</div>
				)}
				{/* Slice just in case API sends down too much data */}
				{items &&
					items.length > 0 &&
					items.slice(0, 5).map((item, i) => (
						<Fragment key={i}>
							{i !== 0 && <hr className='border-white/5' />}
							<ListItem subtext={item.subtext} text={item.text} />
						</Fragment>
					))}
			</div>
		</WidgetContainer>
	)
}

function ListItem(item?: ListWidgetItem) {
	return (
		<div className='text-12 leading-tight'>
			<div className='truncate opacity-20'>{item?.subtext ?? LOADING_DASH}</div>
			<p className='line-clamp-2 text-11 opacity-80 md:text-12'>{item?.text}</p>
		</div>
	)
}
