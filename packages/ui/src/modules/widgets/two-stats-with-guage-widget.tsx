import {Arc} from '@/components/ui/arc'
import {LOADING_DASH} from '@/constants'
import {cn} from '@/lib/utils'
import type {TwoStatsWithProgressWidgetProps} from '@/modules/widgets/shared/constants'

import {compactContainerClass, widgetCaptionClass, WidgetShell} from './shared/widget-shell'

export function TwoStatsWidget({
	items,
	link,
	onClick,
}: TwoStatsWithProgressWidgetProps & {onClick?: (link?: string) => void}) {
	const gauges = items ?? [undefined, undefined]
	return (
		<WidgetShell
			onClick={() => onClick?.(link)}
			compact={<Compact items={items} />}
			className='flex-row items-center justify-center gap-2 p-2.5 w-tall:gap-3 w-tall:p-3 w-expanded:gap-6 w-expanded:px-5'
		>
			{gauges.map((item, i) => (
				<div key={i} className='flex min-w-0 flex-col items-center gap-1 w-tall:gap-1.5'>
					{/* Each ring takes half the width less half the gap, capped per size, so the
					    pair always fits. It holds only the figure and its unit */}
					<div className='relative size-[min(64px,calc((100cqw-28px)/2))] shrink-0 w-tall:size-[min(80px,calc((100cqw-36px)/2))] w-expanded:size-[min(88px,calc((100cqw-64px)/2))] [&>svg]:size-full'>
						<Arc size={94} strokeWidth={7} progress={item?.progress ?? 0} />
						<div className='absolute inset-x-[16%] top-1/2 -translate-y-1/2 text-center'>
							<p className='truncate text-13 leading-tight font-semibold -tracking-2 tabular-nums w-tall:text-15 w-expanded:text-17'>
								{item?.text ?? LOADING_DASH}
							</p>
							{item?.subtext && (
								<p className='truncate text-[10px] leading-tight font-semibold opacity-45 w-tall:text-11 w-expanded:text-12'>
									{item.subtext}
								</p>
							)}
						</div>
					</div>
					{/* w-0 min-w-full: the name takes the ring's width, never sets it */}
					<p className={cn(widgetCaptionClass, 'w-0 min-w-full text-center')}>{item?.title ?? LOADING_DASH}</p>
				</div>
			))}
		</WidgetShell>
	)
}

// Both gauges, stacked and shrunk. Names are dropped
function Compact({items}: TwoStatsWithProgressWidgetProps) {
	const shown = items ?? [undefined, undefined]
	const size = 46
	const strokeWidth = 4
	return (
		<div className={cn(compactContainerClass, 'items-center justify-center gap-1 p-2')}>
			{shown.map((item, i) => (
				<div key={i} className='relative'>
					<Arc strokeWidth={strokeWidth} size={size} progress={item?.progress ?? 0} />
					<div
						className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 truncate text-center text-[10px] leading-none font-semibold tabular-nums'
						style={{width: size - strokeWidth * 2}}
					>
						{item?.text ?? LOADING_DASH}
					</div>
				</div>
			))}
		</div>
	)
}
