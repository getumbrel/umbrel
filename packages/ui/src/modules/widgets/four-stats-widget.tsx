import {take} from 'remeda'

import {LOADING_DASH} from '@/constants'
import {cn} from '@/lib/utils'
import type {FourStatsWidgetProps} from '@/modules/widgets/shared/constants'

import {glassCellClass} from './shared/glass-cell'
import {RollingPairs} from './shared/rolling-pairs'
import {compactContainerClass, compactStatClass, WidgetShell} from './shared/widget-shell'

export function FourStatsWidget({
	items,
	link,
	onClick,
}: FourStatsWidgetProps & {
	onClick?: (link?: string) => void
}) {
	const cells = items ? take(items, 4) : [undefined, undefined, undefined, undefined]
	return (
		<WidgetShell
			onClick={() => onClick?.(link)}
			compact={<Compact items={items} />}
			className='grid grid-cols-2 grid-rows-2 gap-1 p-1.5 w-tall:gap-1.5 w-tall:p-2 w-expanded:gap-2 w-expanded:p-2.5'
		>
			{cells.map((item, i) => (
				<div
					key={i}
					className={cn(
						'flex min-h-0 min-w-0 flex-col justify-center gap-0.5 rounded-10 px-1.5 w-tall:rounded-12 w-tall:px-2 w-expanded:px-5',
						glassCellClass,
					)}
				>
					<p
						className='truncate text-[10px] leading-tight font-semibold -tracking-2 opacity-60 w-tall:text-11'
						title={item?.title}
					>
						{item?.title ?? LOADING_DASH}
					</p>
					<p className='truncate text-12 leading-tight font-semibold -tracking-2 tabular-nums opacity-90 w-tall:text-13'>
						{item?.text ?? LOADING_DASH}
						{item?.subtext && <span className='opacity-50'> {item.subtext}</span>}
					</p>
				</div>
			))}
		</WidgetShell>
	)
}

// Title over value, two at a time, rolling through all four
function Compact({items}: FourStatsWidgetProps) {
	return (
		<div className={cn(compactContainerClass, 'p-2')}>
			<RollingPairs
				items={items}
				gap={4}
				rowClassName={cn('flex min-w-0 flex-col justify-center gap-0.5 rounded-10 px-1.5', glassCellClass)}
				renderRow={(item) => (
					<>
						<p className={cn(compactStatClass, 'text-[10px] opacity-50')}>{item?.title ?? LOADING_DASH}</p>
						<p className={compactStatClass}>
							{item?.text ?? LOADING_DASH}
							{item?.subtext && <span className='opacity-50'> {item.subtext}</span>}
						</p>
					</>
				)}
			/>
		</div>
	)
}
