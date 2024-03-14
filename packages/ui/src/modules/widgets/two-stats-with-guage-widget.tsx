import {Arc} from '@/components/ui/arc'
import {LOADING_DASH} from '@/constants'
import {useIsMobile} from '@/hooks/use-is-mobile'
import type {TwoStatsWithProgressItem, TwoStatsWithProgressWidgetProps} from '@/modules/widgets/shared/constants'

import {WidgetContainer} from './shared/shared'

export function TwoStatsWidget({
	items,
	link,
	onClick,
}: TwoStatsWithProgressWidgetProps & {onClick?: (link?: string) => void}) {
	return (
		<WidgetContainer onClick={() => onClick?.(link)} className=' flex-row items-center justify-center md:gap-[30px]'>
			{items?.[0] && (
				<Item title={items[0].title} text={items[0].text} subtext={items[0].subtext} progress={items[0].progress} />
			)}
			{items?.[1] && (
				<Item title={items[1].title} text={items[1].text} subtext={items[1].subtext} progress={items[1].progress} />
			)}
			{!items && (
				<>
					<Item title={LOADING_DASH} text={LOADING_DASH} />
					<Item title={LOADING_DASH} text={LOADING_DASH} />
				</>
			)}
		</WidgetContainer>
	)
}

function Item(item?: TwoStatsWithProgressItem) {
	const isMobile = useIsMobile()
	const size = isMobile ? 65 : 94
	const strokeWidth = isMobile ? 5 : 7

	return (
		<div className='relative'>
			<Arc strokeWidth={strokeWidth} size={size} progress={item?.progress ?? 0} />
			<div
				className='absolute left-1/2 top-1/2 mt-[1px] -translate-x-1/2 -translate-y-1/2 px-1.5 text-center'
				// Set width so text fits inside the arc
				style={{width: size - strokeWidth * 2}}
			>
				<div className='truncate text-[9px] font-semibold leading-tight tracking-normal md:text-13'>
					{item?.text}
					{item?.subtext && <span className='opacity-40'>{item?.subtext}</span>}
				</div>
				{item?.title && (
					<div className='truncate text-[9px] font-medium leading-tight -tracking-3 opacity-40 md:text-12'>
						{item?.title}
					</div>
				)}
			</div>
		</div>
	)
}
