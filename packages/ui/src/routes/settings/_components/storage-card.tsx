import {Card} from '@/components/ui/card'
import {useDiskForUi} from '@/hooks/use-disk'
import {t} from '@/utils/i18n'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function StorageCard() {
	const {value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull} = useDiskForUi()

	return (
		<Card>
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
		</Card>
	)
}
