import {sort} from 'remeda'

import {LOADING_DASH} from '@/constants'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useCpu(options: {poll?: boolean} = {}) {
	const cpuQ = trpcReact.system.cpuUsage.useQuery(undefined, {
		// Sometimes we won't be able to get disk usage, so prevent retry
		retry: false,
		// We do want refetching to happen on a schedule though
		refetchInterval: options.poll ? 1000 : undefined,
	})

	return {
		data: cpuQ.data,
		isLoading: cpuQ.isLoading,
		//
		percentUsed: cpuQ.data?.totalUsed ?? 0,
		threads: cpuQ.data?.threads ?? 0,
		apps: sort(
			[
				...(cpuQ.data?.apps ?? []),
				{
					id: 'umbreld-system',
					used: cpuQ.data?.system ?? 0,
				},
			],
			(a, b) => b.used - a.used,
		),
	}
}

export function useCpuForUi(options: {poll?: boolean} = {}) {
	const {isLoading, percentUsed, threads, apps} = useCpu({poll: options.poll})

	if (isLoading) {
		return {
			isLoading: true,
			value: LOADING_DASH,
			progress: 0,
			secondaryValue: LOADING_DASH,
		} as const
	}

	return {
		isLoading: false,
		value: Math.ceil(percentUsed) + '%',
		progress: percentUsed / 100,
		secondaryValue: t('cpu-core-count', {cores: threads}),
		apps,
	} as const
}
