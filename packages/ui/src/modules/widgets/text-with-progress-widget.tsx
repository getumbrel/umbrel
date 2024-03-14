import {LOADING_DASH} from '@/constants'
import {TextWithProgressWidgetProps} from '@/modules/widgets/shared/constants'
import {Progress} from '@/shadcn-components/ui/progress'
import {t} from '@/utils/i18n'

import {WidgetContainer, widgetTextCva} from './shared/shared'
import {StatText} from './shared/stat-text'

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
	return (
		<WidgetContainer className='p-2 md:p-5' onClick={() => onClick?.(link)}>
			<StatText title={title ?? LOADING_DASH} value={text} valueSub={subtext} />
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
