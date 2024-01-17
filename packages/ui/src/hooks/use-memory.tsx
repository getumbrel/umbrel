import BigNumber from 'bignumber.js'
import {sort} from 'remeda'

import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {isMemoryLow} from '@/utils/system'

export function useMemory(options: {poll?: boolean} = {}) {
	const memoryQ = trpcReact.system.memoryUsage.useQuery(undefined, {
		// Sometimes we won't be able to get disk usage, so prevent retry
		retry: false,
		// We do want refetching to happen on a schedule though
		refetchInterval: options.poll ? 500 : undefined,
	})

	const used = memoryQ.data?.totalUsed
	const size = memoryQ.data?.size
	const available = !size || !used ? undefined : size - used

	return {
		data: memoryQ.data,
		isLoading: memoryQ.isLoading,
		//
		used,
		size,
		available,
		apps: sort(memoryQ.data?.apps ?? [], (a, b) => b.used - a.used),
		isMemoryLow: isMemoryLow({size, used}),
	}
}

export function useMemoryForUi(options: {poll?: boolean} = {}) {
	const {isLoading, used, size, available, apps, isMemoryLow} = useMemory({poll: options.poll})

	if (isLoading) {
		return {
			value: '–',
			valueSub: '/ –',
			secondaryValue: '– left',
			progress: 0,
		}
	}

	return {
		value: maybePrettyBytes(used),
		valueSub: `/ ${maybePrettyBytes(size)}`,
		secondaryValue: `${maybePrettyBytes(available)} left`,
		progress: BigNumber(used ?? 0 * 100)
			.dividedBy(size ?? 0)
			.toNumber(),
		isMemoryLow,
		apps,
	}
}
