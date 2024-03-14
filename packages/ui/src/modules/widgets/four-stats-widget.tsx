import {LOADING_DASH} from '@/constants'
import {cn} from '@/shadcn-lib/utils'

import {WidgetContainer, widgetTextCva} from './shared/shared'

export function FourStatsWidget({
	items,
	link,
	onClick,
}: {
	items?: {title: string; value: string; valueSub: string}[]
	link?: string
	onClick?: (link?: string) => void
}) {
	return (
		<WidgetContainer
			onClick={() => onClick?.(link)}
			className='grid grid-cols-2 grid-rows-2 gap-0 gap-1 p-1.5 md:gap-2 md:p-2.5'
		>
			{items
				?.slice(0, 4)
				?.map((item) => <Item key={item.title} title={item.title} value={item.value} valueSub={item.valueSub} />)}
			{!items && (
				<>
					<Item title={LOADING_DASH} value={LOADING_DASH} valueSub={LOADING_DASH} />
					<Item title={LOADING_DASH} value={LOADING_DASH} valueSub={LOADING_DASH} />
					<Item title={LOADING_DASH} value={LOADING_DASH} valueSub={LOADING_DASH} />
					<Item title={LOADING_DASH} value={LOADING_DASH} valueSub={LOADING_DASH} />
				</>
			)}
		</WidgetContainer>
	)
}

function Item({title, value, valueSub}: {title?: string; value?: string; valueSub?: string}) {
	return (
		<div className='flex h-full flex-col justify-center rounded-5 bg-white/5 px-1 leading-none md:rounded-12 md:px-5'>
			<p
				className={cn(
					widgetTextCva({
						opacity: 'secondary',
					}),
					'text-[8px] md:text-11',
				)}
				title={value}
			>
				{title}
			</p>
			<p className={widgetTextCva()}>
				{value} <span className={widgetTextCva({opacity: 'tertiary'})}>{valueSub}</span>
			</p>
		</div>
	)
}
