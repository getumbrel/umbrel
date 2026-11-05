import {useTranslation} from 'react-i18next'

import {Progress} from '@/components/ui/progress'
import {LOADING_DASH} from '@/constants'
import {cn} from '@/lib/utils'
import {TextWithProgressWidgetProps} from '@/modules/widgets/shared/constants'

import {
	compactContainerClass,
	compactLabelClass,
	compactValueClass,
	widgetCaptionClass,
	WidgetShell,
	widgetValueClass,
	widgetValueUnitClass,
} from './shared/widget-shell'

export function TextWithProgressWidget({
	title,
	text,
	subtext,
	progressLabel,
	progress = 0,
	link,
	onClick,
}: TextWithProgressWidgetProps & {
	onClick?: (link?: string) => void
}) {
	const {t} = useTranslation()
	return (
		<WidgetShell
			onClick={() => onClick?.(link)}
			compact={<Compact title={title} text={text} progress={progress} />}
			className='p-2.5 w-regular:p-3 w-tall:p-4 w-expanded:p-5'
		>
			<p className={widgetCaptionClass}>{title ?? LOADING_DASH}</p>
			<p className='mt-1.5 flex min-w-0 items-baseline gap-1 w-expanded:mt-2'>
				<span className={widgetValueClass}>{text ?? LOADING_DASH}</span>
				{/* "/ 2 TB" is the first thing to go */}
				{subtext && <span className={cn(widgetValueUnitClass, 'hidden w-regular:inline')}>{subtext}</span>}
			</p>
			<div className='flex-1' />
			{/* Show "In progress" if we don't have a progress label and there's some progress. Otherwise, just show a dash. */}
			<p className={widgetCaptionClass}>
				{progressLabel || (progress ? t('widget.progress.in-progress') : LOADING_DASH)}
			</p>
			<Progress className='mt-1.5 w-expanded:mt-2' value={Number(progress) * 100} trackClassName='shadow-glass-track' />
		</WidgetShell>
	)
}

// Title, value and the bar, with the percentage in place of the progress label
function Compact({title, text, progress = 0}: TextWithProgressWidgetProps) {
	return (
		<div className={compactContainerClass}>
			<div className={compactLabelClass}>{title ?? LOADING_DASH}</div>
			<div className={compactValueClass}>{text ?? LOADING_DASH}</div>
			<div className='flex-1' />
			<div className={compactLabelClass}>{Math.round(Number(progress) * 100)}%</div>
			<Progress value={Number(progress) * 100} trackClassName='shadow-glass-track' />
		</div>
	)
}
