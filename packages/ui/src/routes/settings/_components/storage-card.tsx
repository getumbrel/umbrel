import BigNumber from 'bignumber.js'

import {Card} from '@/components/ui/card'
import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {isDiskFull, isDiskLow} from '@/utils/system'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function StorageCard() {
	const diskQ = trpcReact.system.diskUsage.useQuery()

	if (diskQ.isLoading)
		return (
			<Card>
				<ProgressStatCardContent title='Storage' value='–' valueSub='/ –' secondaryValue='– left' progress={0} />
			</Card>
		)

	return (
		<Card>
			<ProgressStatCardContent
				title='Storage'
				value={maybePrettyBytes(diskQ.data?.used)}
				valueSub={`/ ${maybePrettyBytes(diskQ.data?.size)}`}
				secondaryValue={`${maybePrettyBytes(diskQ.data?.available)} left`}
				progress={BigNumber(diskQ.data?.used ?? 0 * 100)
					.dividedBy(diskQ.data?.size ?? 0)
					.toNumber()}
				afterChildren={
					<>
						{isDiskLow(diskQ.data?.available ?? 0) && <span className={cardErrorClass}>Disk is low.</span>}
						{isDiskFull(diskQ.data?.available ?? 0) && <span className={cardErrorClass}>Disk is full.</span>}
					</>
				}
			/>
		</Card>
	)
}
