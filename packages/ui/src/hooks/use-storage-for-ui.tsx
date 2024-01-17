import BigNumber from 'bignumber.js'
import {useInterval} from 'react-use'
import {sort} from 'remeda'

import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {isDiskFull, isDiskLow} from '@/utils/system'

export function useStorageForUi(options: {poll?: boolean} = {}) {
	const diskQ = trpcReact.system.diskUsage.useQuery()

	useInterval(diskQ.refetch, options.poll ? 500 : null)

	if (diskQ.isLoading) {
		return {
			value: '–',
			valueSub: '/ –',
			secondaryValue: '– left',
			progress: 0,
		}
	}

	const used = diskQ.data?.totalUsed
	const size = diskQ.data?.size
	const available = !size || !used ? undefined : size - used

	return {
		value: maybePrettyBytes(used),
		valueSub: `/ ${maybePrettyBytes(size)}`,
		secondaryValue: `${maybePrettyBytes(available)} left`,
		progress: BigNumber(used ?? 0 * 100)
			.dividedBy(size ?? 0)
			.toNumber(),
		isDiskLow: isDiskLow(available),
		isDiskFull: isDiskFull(available),
		apps: sort(diskQ.data?.apps ?? [], (a, b) => b.used - a.used),
	}
}
