import {LOADING_DASH} from '@/constants'
import {Progress} from '@/shadcn-components/ui/progress'
import {t} from '@/utils/i18n'

import {WidgetContainer, widgetTextCva} from './shared/shared'
import {StatText} from './shared/stat-text'

export function ProgressWidget({
	title,
	value,
	valueSub,
	progressLabel,
	progress = 0,
	onClick,
}: {
	title?: string
	value?: string
	valueSub?: string
	progressLabel?: string
	/** Progress from 0 to 1 */
	progress?: number
	onClick?: () => void
}) {
	return (
		<WidgetContainer className='p-2 md:p-5' onClick={onClick}>
			<StatText title={title ?? LOADING_DASH} value={value} valueSub={valueSub} />
			<div className='flex-1' />
			{/* TODO: use shadcn progress component */}
			{/* Show "In progress" if we don't have a progress label and there's some progress. Otherwise, just show a dash. */}
			<div className={widgetTextCva({opacity: 'secondary'})}>
				{progressLabel || (progress ? t('widget.progress.in-progress') : LOADING_DASH)}
			</div>
			<Progress value={progress * 100} />
		</WidgetContainer>
	)
}
