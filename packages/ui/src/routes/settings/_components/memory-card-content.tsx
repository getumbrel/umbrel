import {useTranslation} from 'react-i18next'

import {useSystemMemoryForUi} from '@/hooks/use-memory'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function MemoryCardContent() {
	const {t} = useTranslation()
	const {value, valueSub, secondaryValue, progress, isMemoryLow} = useSystemMemoryForUi()

	return (
		<ProgressStatCardContent
			title={t('memory')}
			value={value}
			valueSub={valueSub}
			secondaryValue={secondaryValue}
			progress={progress}
			afterChildren={isMemoryLow && <span className={cardErrorClass}>{t('memory.low')}</span>}
		/>
	)
}
