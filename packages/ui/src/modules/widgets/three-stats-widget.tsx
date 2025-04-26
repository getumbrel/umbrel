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
			className='flex flex-col items-stretch justify-stretch gap-1.5 p-1.5 sm:flex-row sm:gap-2 sm:px-4 sm:py-3'
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
		<div className='flex min-w-0 flex-1 items-center overflow-hidden rounded-5 bg-white/5 px-1 duration-300 animate-in fade-in max-sm:gap-1 max-sm:px-1 sm:flex-col sm:justify-center sm:rounded-full'>
			{/* `[&>svg]` to select child svg */}
			{item?.icon && <TablerIcon iconName={item?.icon} className='h-5 w-5 sm:mb-4 [&>svg]:h-5 [&>svg]:w-5' />}
			<div className='flex w-full flex-row justify-between sm:flex-col sm:text-center'>
				<p className={cn(widgetTextCva({opacity: 'secondary'}), 'max-w-full truncate')}>{item?.subtext}</p>
				<p className={cn(widgetTextCva(), 'max-w-full truncate')}>{item?.text}</p>
			</div>
		</div>
	)
}
