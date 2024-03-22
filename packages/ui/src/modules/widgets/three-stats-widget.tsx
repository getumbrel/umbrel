import {LOADING_DASH} from '@/constants'
import type {ThreeStatsItem, ThreeStatsWidget, ThreeStatsWidgetProps} from '@/modules/widgets/shared/constants'
import {cn} from '@/shadcn-lib/utils'

import {WidgetContainer, widgetTextCva} from './shared/shared'
import {TablerIcon} from './shared/tabler-icon'

export function ThreeStatsWidget({
	items,
	link,
	onClick,
}: ThreeStatsWidgetProps & {
	onClick?: (link?: string) => void
}) {
	return (
		<WidgetContainer
			onClick={() => onClick?.(link)}
			className='flex flex-col items-stretch justify-stretch gap-1.5 p-1.5 md:flex-row md:gap-2 md:px-4 md:py-3'
		>
			{items?.[0] && <Item icon={items[0].icon} subtext={items[0].subtext} text={items[0].text} />}
			{items?.[1] && <Item icon={items[1].icon} subtext={items[1].subtext} text={items[1].text} />}
			{items?.[2] && <Item icon={items[2].icon} subtext={items[2].subtext} text={items[2].text} />}
			{!items && (
				<>
					<Item icon='' subtext={LOADING_DASH} text={LOADING_DASH} />
					<Item icon='' subtext={LOADING_DASH} text={LOADING_DASH} />
					<Item icon='' subtext={LOADING_DASH} text={LOADING_DASH} />
				</>
			)}
		</WidgetContainer>
	)
}

function Item(item?: ThreeStatsItem) {
	return (
		// NOTE: consider reducing rounding if we don't have 3 items
		<div className='flex min-w-0 flex-1 items-center overflow-hidden rounded-5 bg-white/5 px-1 duration-300 animate-in fade-in max-md:gap-1 max-md:px-1 md:flex-col md:justify-center md:rounded-full'>
			{/* `[&>svg]` to select child svg */}
			{item?.icon && <TablerIcon iconName={item?.icon} className='h-5 w-5 md:mb-4 [&>svg]:h-5 [&>svg]:w-5' />}
			<div className='flex w-full flex-row justify-between md:flex-col md:text-center'>
				<p className={cn(widgetTextCva({opacity: 'secondary'}), 'max-w-full truncate')}>{item?.subtext}</p>
				<p className={cn(widgetTextCva(), 'max-w-full truncate')}>{item?.text}</p>
			</div>
		</div>
	)
}
