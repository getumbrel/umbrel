import {useCpuForUi} from '@/hooks/use-cpu'
import {t} from '@/utils/i18n'

import {ProgressStatCardContent} from './progress-card-content'

export function CpuCardContent() {
	const {value, secondaryValue, progress} = useCpuForUi()

	return <ProgressStatCardContent title={t('cpu')} value={value} secondaryValue={secondaryValue} progress={progress} />
}
