import {useSystemDiskForUi} from '@/hooks/use-disk'
import {t} from '@/utils/i18n'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function StorageCardContent() {
	const {value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull} = useSystemDiskForUi()

	return (
		<ProgressStatCardContent
			title={t('storage')}
			value={value}
			valueSub={valueSub}
			secondaryValue={secondaryValue}
			progress={progress}
			afterChildren={
				<>
					{isDiskLow && <span className={cardErrorClass}>{t('storage.low')}</span>}
					{isDiskFull && <span className={cardErrorClass}>{t('storage.full')}</span>}
				</>
			}
		/>
	)
}
