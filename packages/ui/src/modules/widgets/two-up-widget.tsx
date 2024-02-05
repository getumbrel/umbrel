import {Arc} from '@/components/ui/arc'
import {useIsMobile} from '@/hooks/use-is-mobile'

import {WidgetContainer} from './shared/shared'

type TwoUpItem = {title?: string; value?: string; valueSub?: string; progress?: number}

export function TwoUpWidget({items, onClick}: {items?: [TwoUpItem, TwoUpItem]; onClick?: () => void}) {
	return (
		<WidgetContainer onClick={onClick} className=' flex-row items-center justify-center md:gap-[30px]'>
			{items?.[0] && (
				<TwoUpItem
					title={items[0].title}
					value={items[0].value}
					valueSub={items[0].valueSub}
					progress={items[0].progress}
				/>
			)}
			{items?.[1] && (
				<TwoUpItem
					title={items[1].title}
					value={items[1].value}
					valueSub={items[1].valueSub}
					progress={items[1].progress}
				/>
			)}
			{!items && (
				<>
					<TwoUpItem title='–' value='–' />
					<TwoUpItem title='–' value='–' />
				</>
			)}
		</WidgetContainer>
	)
}

function TwoUpItem({title, value, valueSub, progress}: TwoUpItem) {
	const isMobile = useIsMobile()
	const size = isMobile ? 65 : 94
	const strokeWidth = isMobile ? 5 : 7

	return (
		<div className='relative'>
			<Arc strokeWidth={strokeWidth} size={size} progress={progress ?? 0} />
			<div
				className='absolute left-1/2 top-1/2 mt-[1px] -translate-x-1/2 -translate-y-1/2 px-1.5 text-center'
				// Set width so text fits inside the arc
				style={{width: size - strokeWidth * 2}}
			>
				<div className='truncate text-[9px] font-semibold leading-tight tracking-normal md:text-13'>
					{value}
					{valueSub && <span className='opacity-40'>{valueSub}</span>}
				</div>
				{title && (
					<div className='truncate text-[9px] font-medium leading-tight -tracking-3 opacity-40 md:text-12'>{title}</div>
				)}
			</div>
		</div>
	)
}
