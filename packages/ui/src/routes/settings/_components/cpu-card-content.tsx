import {useTranslation} from 'react-i18next'

import {useCpuForUi} from '@/hooks/use-cpu'

import {ProgressStatCardContent} from './progress-card-content'

export function CpuCardContent() {
	const {t} = useTranslation()
	const {value, secondaryValue, progress} = useCpuForUi()

	return <ProgressStatCardContent title={t('cpu')} value={value} secondaryValue={secondaryValue} progress={progress} />
}
