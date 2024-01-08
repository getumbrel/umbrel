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

	return {
		value: maybePrettyBytes(memoryQ.data?.used),
		valueSub: `/ ${maybePrettyBytes(memoryQ.data?.size)}`,
		secondaryValue: `${maybePrettyBytes(memoryQ.data?.available)} left`,
		progress: BigNumber(memoryQ.data?.used ?? 0 * 100)
			.dividedBy(memoryQ.data?.size ?? 0)
			.toNumber(),
		isMemoryLow: memoryQ.data && isMemoryLow(memoryQ.data),
		apps: sort(memoryQ.data?.apps ?? [], (a, b) => b.memory - a.memory),
	}
}
