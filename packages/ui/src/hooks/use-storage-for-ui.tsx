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

	return {
		value: maybePrettyBytes(diskQ.data?.used),
		valueSub: `/ ${maybePrettyBytes(diskQ.data?.size)}`,
		secondaryValue: `${maybePrettyBytes(diskQ.data?.available)} left`,
		progress: BigNumber(diskQ.data?.used ?? 0 * 100)
			.dividedBy(diskQ.data?.size ?? 0)
			.toNumber(),
		isDiskLow: diskQ.data && isDiskLow(diskQ.data?.available),
		isDiskFull: diskQ.data && isDiskFull(diskQ.data.available),
		apps: sort(diskQ.data?.apps ?? [], (a, b) => b.disk - a.disk),
	}
}
