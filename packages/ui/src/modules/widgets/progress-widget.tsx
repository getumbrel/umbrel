import {Progress} from '@/shadcn-components/ui/progress'

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
			<StatText title={title} value={value} valueSub={valueSub} />
			<div className='flex-1' />
			{/* TODO: use shadcn progress component */}
			{/* Show "In progress" if we don't have a progress label and there's some progress. Otherwise, just show a dash. */}
			<div className={widgetTextCva({opacity: 'secondary'})}>{progressLabel || (progress ? 'In progress' : '–')}</div>
			<Progress value={progress * 100} />
		</WidgetContainer>
	)
}
