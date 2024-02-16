import {Card} from '@/components/ui/card'
import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {useMemoryForUi} from '@/hooks/use-memory'
import {t} from '@/utils/i18n'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function MemoryCard() {
	const {value, valueSub, secondaryValue, progress, isMemoryLow} = useMemoryForUi()

	return (
		<Card id={SETTINGS_SYSTEM_CARDS_ID}>
			<ProgressStatCardContent
				title={t('memory')}
				value={value}
				valueSub={valueSub}
				secondaryValue={secondaryValue}
				progress={progress}
				afterChildren={isMemoryLow && <span className={cardErrorClass}>{t('memory.low')}</span>}
			/>
		</Card>
	)
}
