import {LOADING_DASH} from '@/constants'
import {cn} from '@/lib/utils'
import type {ThreeStatsWidgetProps} from '@/modules/widgets/shared/constants'

import {glassCellClass} from './shared/glass-cell'
import {RollingPairs} from './shared/rolling-pairs'
import {TablerIcon} from './shared/tabler-icon'
import {compactContainerClass, compactStatClass, widgetCaptionClass, WidgetShell} from './shared/widget-shell'

export function ThreeStatsWidget({
	items,
	link,
	onClick,
}: ThreeStatsWidgetProps & {
	onClick?: (link?: string) => void
}) {
	const rows = items ?? [undefined, undefined, undefined]
	return (
		<WidgetShell
			onClick={() => onClick?.(link)}
			compact={<Compact items={items} />}
			className='gap-1 p-1.5 w-tall:gap-1.5 w-tall:p-2 w-expanded:flex-row w-expanded:gap-2 w-expanded:px-4 w-expanded:py-3'
		>
			{rows.map((item, i) => (
				// Rows on the phone, pills side by side on the desktop
				<div
					key={i}
					className={cn(
						'flex min-h-0 min-w-0 flex-1 animate-in items-center gap-1.5 rounded-10 px-2 duration-300 fade-in w-tall:rounded-12 w-expanded:flex-col w-expanded:justify-center w-expanded:gap-0 w-expanded:rounded-full w-expanded:px-1',
						glassCellClass,
					)}
				>
					{/* `[&>svg]` to select child svg. While loading, a placeholder of the same size */}
					{item?.icon ? (
						<TablerIcon iconName={item.icon} className='size-5 shrink-0 w-expanded:mb-4 [&>svg]:size-full' />
					) : (
						<span className='size-5 shrink-0 rounded-5 bg-white/5 w-expanded:mb-4' />
					)}
					<p className={cn(widgetCaptionClass, 'min-w-0 flex-1 w-expanded:flex-none')}>
						{item?.subtext ?? LOADING_DASH}
					</p>
					<p className='ml-auto truncate text-12 leading-tight font-semibold -tracking-2 tabular-nums opacity-80 w-tall:text-13 w-expanded:ml-0 w-expanded:max-w-full'>
						{item?.text ?? LOADING_DASH}
					</p>
				</div>
			))}
		</WidgetShell>
	)
}

// Icon over value, two at a time, rolling through all three
function Compact({items}: ThreeStatsWidgetProps) {
	return (
		<div className={cn(compactContainerClass, 'p-2')}>
			<RollingPairs
				items={items}
				// Flat tint, matching the rows of the regular widget
				rowClassName='flex flex-col items-center justify-center gap-0.5 rounded-10 bg-white/5 px-1'
				renderRow={(item) => (
					<>
						{item?.icon && <TablerIcon iconName={item.icon} className='size-[13px] opacity-80 [&>svg]:size-full' />}
						<p className={cn(compactStatClass, 'max-w-full')}>{item?.text ?? LOADING_DASH}</p>
					</>
				)}
			/>
		</div>
	)
}
