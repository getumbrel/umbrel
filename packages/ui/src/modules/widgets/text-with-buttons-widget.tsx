import {take} from 'remeda'

import {LOADING_DASH} from '@/constants'
import {cn} from '@/lib/utils'
import type {TextWithButtonsWidgetProps} from '@/modules/widgets/shared/constants'

import {glassCellClass, glassCellInteractiveClass} from './shared/glass-cell'
import {TablerIcon} from './shared/tabler-icon'
import {
	compactContainerClass,
	compactLabelClass,
	compactValueClass,
	widgetCaptionClass,
	WidgetShell,
	widgetValueClass,
	widgetValueUnitClass,
} from './shared/widget-shell'

// The container isn't a button (the buttons are). Buttons stack on the phone and
// sit in a row on the desktop. Each button is its own container and drops its
// label for its icon once it's too narrow for both.
export function TextWithButtonsWidget({
	title,
	text,
	subtext,
	buttons,
	onClick,
}: TextWithButtonsWidgetProps & {
	onClick?: (link: string) => void
}) {
	return (
		<WidgetShell
			compact={<Compact title={title} text={text} buttons={buttons} onClick={onClick} />}
			className='p-2.5 w-regular:p-3 w-tall:p-4 w-expanded:p-5'
		>
			<p className={widgetCaptionClass}>{title ?? LOADING_DASH}</p>
			<p className='mt-1.5 flex min-w-0 items-baseline gap-1 w-expanded:mt-2'>
				<span className={widgetValueClass}>{text ?? LOADING_DASH}</span>
				{subtext && <span className={widgetValueUnitClass}>{subtext}</span>}
			</p>
			<div className='flex-1' />
			<div className='flex flex-col gap-1 w-tall:gap-1.5 w-expanded:flex-row'>
				{take(buttons ?? [], 3).map((button, i) => (
					// Not using `link` for `key` in case user wants two buttons to link to the same `link` for some reason
					<button
						key={i}
						title={button.text}
						aria-label={button.text}
						onClick={() => onClick?.(button.link)}
						className={cn(
							'flex h-6 min-w-0 flex-1 shrink-0 items-center justify-center gap-1 rounded-full px-2 [container:button/inline-size] w-tall:h-7 w-expanded:h-[30px]',
							glassCellClass,
							glassCellInteractiveClass,
							// Two fit stacked; the desktop row takes three. Last, so twMerge keeps `hidden` over `flex`
							i >= 2 && 'hidden w-expanded:flex',
						)}
					>
						{button.icon && <TablerIcon iconName={button.icon} className='size-3.5 shrink-0 [&>svg]:size-full' />}
						<span className={cn('truncate text-12 font-medium', button.icon && 'hidden @min-[64px]/button:inline')}>
							{button.text}
						</span>
					</button>
				))}
			</div>
		</WidgetShell>
	)
}

// Title and value, buttons collapse to icon-only circles (two at most)
function Compact({title, text, buttons, onClick}: TextWithButtonsWidgetProps & {onClick?: (link: string) => void}) {
	return (
		<div className={compactContainerClass}>
			<div className={compactLabelClass}>{title ?? LOADING_DASH}</div>
			<div className={compactValueClass}>{text ?? LOADING_DASH}</div>
			<div className='flex-1' />
			<div className='flex gap-1'>
				{buttons &&
					take(buttons, 2).map((button, i) => (
						<button
							key={i}
							title={button.text}
							aria-label={button.text}
							onClick={() => onClick?.(button.link)}
							className={cn(
								'flex h-[26px] flex-1 items-center justify-center rounded-full',
								glassCellClass,
								glassCellInteractiveClass,
							)}
						>
							{button.icon ? (
								<TablerIcon iconName={button.icon} className='size-3.5 [&>svg]:size-full' />
							) : (
								<span className='text-11 font-semibold'>{button.text?.[0]}</span>
							)}
						</button>
					))}
			</div>
		</div>
	)
}
