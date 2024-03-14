import {LOADING_DASH} from '@/constants'
import type {FourStatsItem, FourStatsWidget, FourStatsWidgetProps} from '@/modules/widgets/shared/constants'
import {cn} from '@/shadcn-lib/utils'

import {WidgetContainer, widgetTextCva} from './shared/shared'

export function FourStatsWidget({
	items,
	link,
	onClick,
}: FourStatsWidgetProps & {
	onClick?: (link?: string) => void
}) {
	return (
		<WidgetContainer
			onClick={() => onClick?.(link)}
			className='grid grid-cols-2 grid-rows-2 gap-0 gap-1 p-1.5 md:gap-2 md:p-2.5'
		>
			{items
				?.slice(0, 4)
				?.map((item) => <Item key={item.title} title={item.title} text={item.text} subtext={item.subtext} />)}
			{!items && (
				<>
					<Item title={LOADING_DASH} text={LOADING_DASH} subtext={LOADING_DASH} />
					<Item title={LOADING_DASH} text={LOADING_DASH} subtext={LOADING_DASH} />
					<Item title={LOADING_DASH} text={LOADING_DASH} subtext={LOADING_DASH} />
					<Item title={LOADING_DASH} text={LOADING_DASH} subtext={LOADING_DASH} />
				</>
			)}
		</WidgetContainer>
	)
}

function Item(item?: FourStatsItem) {
	return (
		<div className='flex h-full flex-col justify-center rounded-5 bg-white/5 px-1 leading-none md:rounded-12 md:px-5'>
			<p
				className={cn(
					widgetTextCva({
						opacity: 'secondary',
					}),
					'text-[8px] md:text-11',
				)}
				title={item?.text}
			>
				{item?.title}
			</p>
			<p className={widgetTextCva()}>
				{item?.text} <span className={widgetTextCva({opacity: 'tertiary'})}>{item?.subtext}</span>
			</p>
		</div>
	)
}
