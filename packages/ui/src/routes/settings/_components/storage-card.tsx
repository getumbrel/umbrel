import {Card} from '@/components/ui/card'
import {useDiskForUi} from '@/hooks/use-disk'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function StorageCard() {
	const {value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull} = useDiskForUi()

	return (
		<Card>
			<ProgressStatCardContent
				title='Storage'
				value={value}
				valueSub={valueSub}
				secondaryValue={secondaryValue}
				progress={progress}
				afterChildren={
					<>
						{isDiskLow && <span className={cardErrorClass}>Disk is low</span>}
						{isDiskFull && <span className={cardErrorClass}>Disk is full</span>}
					</>
				}
			/>
		</Card>
	)
}
