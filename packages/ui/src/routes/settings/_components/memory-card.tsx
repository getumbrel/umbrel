import BigNumber from 'bignumber.js'

import {Card} from '@/components/ui/card'
import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {isMemoryLow} from '@/utils/system'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function MemoryCard() {
	const memoryQ = trpcReact.system.memoryUsage.useQuery()

	if (memoryQ.isLoading) {
		return (
			<Card>
				<ProgressStatCardContent title='Memory' value='–' valueSub='/ –' secondaryValue='– left' progress={0} />
			</Card>
		)
	}

	return (
		<Card id={SETTINGS_SYSTEM_CARDS_ID}>
			<ProgressStatCardContent
				title='Memory'
				value={maybePrettyBytes(memoryQ.data?.used)}
				valueSub={`/ ${maybePrettyBytes(memoryQ.data?.size)}`}
				secondaryValue={`${maybePrettyBytes(memoryQ.data?.available)} left`}
				progress={BigNumber(memoryQ.data?.used ?? 0 * 100)
					.dividedBy(memoryQ.data?.size ?? 0)
					.toNumber()}
				afterChildren={
					memoryQ.data && isMemoryLow(memoryQ.data) && <span className={cardErrorClass}>Memory is low.</span>
				}
			/>
		</Card>
	)
}
