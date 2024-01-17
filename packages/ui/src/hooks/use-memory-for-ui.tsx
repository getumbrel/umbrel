import BigNumber from 'bignumber.js'
import {useInterval} from 'react-use'
import {sort} from 'remeda'

import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {isMemoryLow} from '@/utils/system'

export function useMemoryForUi(options: {poll?: boolean} = {}) {
	const memoryQ = trpcReact.system.memoryUsage.useQuery()

	useInterval(memoryQ.refetch, options.poll ? 500 : null)

	if (memoryQ.isLoading) {
		return {
			value: '–',
			valueSub: '/ –',
			secondaryValue: '– left',
			progress: 0,
		}
	}

	const used = memoryQ.data?.totalUsed
	const size = memoryQ.data?.size
	const available = !size || !used ? undefined : size - used

	return {
		value: maybePrettyBytes(used),
		valueSub: `/ ${maybePrettyBytes(size)}`,
		secondaryValue: `${maybePrettyBytes(available)} left`,
		progress: BigNumber(used ?? 0 * 100)
			.dividedBy(size ?? 0)
			.toNumber(),
		isMemoryLow: isMemoryLow({size, used}),
		apps: sort(memoryQ.data?.apps ?? [], (a, b) => b.used - a.used),
	}
}
