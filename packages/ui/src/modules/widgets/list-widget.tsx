import {LOADING_DASH} from '@/constants'
import {cn} from '@/lib/utils'
import type {ListWidgetProps} from '@/modules/widgets/shared/constants'

import {softBreaks} from './shared/text'
import {
	compactContainerClass,
	compactLabelClass,
	compactValueClass,
	widgetCaptionClass,
	WidgetShell,
} from './shared/widget-shell'

// Each item is its text (one line) over its detail (one line). Whole items only:
// two on the phone, three on the larger scale.
export function ListWidget({
	items,
	link,
	noItemsText = 'Nothing to show.',
	onClick,
}: ListWidgetProps & {
	onClick?: (link?: string) => void
}) {
	return (
		<WidgetShell
			onClick={() => onClick?.(link)}
			compact={<Compact items={items} noItemsText={noItemsText} />}
			className='gap-2.5 p-3 w-tall:gap-3 w-tall:p-4 w-expanded:gap-2 w-expanded:px-5'
		>
			{items?.length === 0 ? (
				<p className={cn(widgetCaptionClass, 'grid h-full place-items-center text-center')}>{noItemsText}</p>
			) : (
				// Slice just in case API sends down too much data
				(items ?? [undefined]).slice(0, 3).map((item, i) => (
					<div key={i} className={cn('min-w-0', i === 2 && 'hidden w-tall:block')}>
						<p className='truncate text-12 leading-[15px] font-medium opacity-90 w-expanded:text-13 w-expanded:leading-4'>
							{item?.text ?? LOADING_DASH}
						</p>
						{item?.subtext && <p className={cn(widgetCaptionClass, 'mt-0.5')}>{item.subtext}</p>}
					</div>
				))
			)}
		</WidgetShell>
	)
}

// The latest item, read like a note: its text first, its detail under it, and
// how many more there are. An item that leads with a short figure ("33% • Ubuntu
// 22.04…", Transmission's shape) shows the figure as the widget's figure, the
// way every other widget leads with one, instead of wrapping it into the prose.
function Compact({items, noItemsText}: ListWidgetProps) {
	if (items?.length === 0) {
		return (
			<div className={cn(compactContainerClass, 'justify-center text-center', compactLabelClass)}>{noItemsText}</div>
		)
	}
	const item = items?.[0]
	const {lead, rest} = splitLead(item?.text ?? '')
	const more = (items?.length ?? 0) - 1
	return (
		<div className={cn(compactContainerClass, 'gap-0')}>
			{lead && <p className={cn(compactValueClass, 'mb-1')}>{lead}</p>}
			<p
				className={cn(
					'text-11 leading-[14px] font-medium text-pretty opacity-90',
					lead ? 'line-clamp-2' : 'line-clamp-3',
				)}
			>
				{item ? softBreaks(rest) : LOADING_DASH}
			</p>
			{item?.subtext && <p className={cn(compactLabelClass, 'mt-1')}>{item.subtext}</p>}
			<div className='flex-1' />
			{more > 0 && <p className={compactLabelClass}>{more} more</p>}
		</div>
	)
}

/** "33% • Ubuntu 22.04.3" → {lead: "33%", rest: "Ubuntu 22.04.3"}; anything else is all rest */
function splitLead(text: string) {
	const match = text.match(/^(\S{1,7})\s+[•·]\s+(.+)$/)
	return match ? {lead: match[1], rest: match[2]} : {lead: '', rest: text}
}
