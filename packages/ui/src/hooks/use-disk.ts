import BigNumber from 'bignumber.js'
import {sort} from 'remeda'

import {LOADING_DASH} from '@/constants'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {isDiskFull, isDiskLow, trpcDiskToLocal} from '@/utils/system'

export function useDisk(options: {poll?: boolean} = {}) {
	const diskQ = trpcReact.system.diskUsage.useQuery(undefined, {
		// Sometimes we won't be able to get disk usage, so prevent retry
		retry: false,
		// We do want refetching to happen on a schedule though
		refetchInterval: options.poll ? 500 : undefined,
	})

	const transformed = trpcDiskToLocal(diskQ.data)

	return {
		data: diskQ.data,
		isLoading: diskQ.isLoading,
		//
		...transformed,
		system: diskQ.data?.system,
		downloads: diskQ.data?.downloads,
		apps: sort(diskQ.data?.apps ?? [], (a, b) => b.used - a.used),
		isDiskLow: isDiskLow(transformed?.available),
		isDiskFull: isDiskFull(transformed?.available),
	}
}

export function useDiskForUi(options: {poll?: boolean} = {}) {
	const {isLoading, used, size, available, isDiskFull, isDiskLow, system, downloads, apps} = useDisk({
		poll: options.poll,
	})

	if (isLoading) {
		return {
			isLoading: true,
			value: LOADING_DASH,
			valueSub: '/ ' + LOADING_DASH,
			secondaryValue: LOADING_DASH,
			progress: 0,
		} as const
	}

	return {
		isLoading: false,
		value: maybePrettyBytes(used),
		valueSub: `/ ${maybePrettyBytes(size)}`,
		secondaryValue: t('something-left', {left: maybePrettyBytes(available)}),
		progress: BigNumber(used ?? 0)
			.dividedBy(size ?? 0)
			.toNumber(),
		isDiskLow,
		isDiskFull,
		system,
		downloads,
		apps,
	} as const
}
