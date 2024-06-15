import BigNumber from 'bignumber.js'
import {sort} from 'remeda'

import {LOADING_DASH} from '@/constants'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {isMemoryLow, trpcMemoryToLocal} from '@/utils/system'

export function useSystemMemory(options: {poll?: boolean} = {}) {
	const memoryQ = trpcReact.system.systemMemoryUsage.useQuery(undefined, {
		// Sometimes we won't be able to get disk usage, so prevent retry
		retry: false,
		// We do want refetching to happen on a schedule though
		refetchInterval: options.poll ? 1000 : undefined,
	})

	const transformed = trpcMemoryToLocal(memoryQ.data)

	return {
		data: memoryQ.data,
		isLoading: memoryQ.isLoading,
		//
		...transformed,
		isMemoryLow: isMemoryLow({size: transformed?.size, used: transformed?.used}),
	}
}

export function useMemory(options: {poll?: boolean} = {}) {
	const memoryQ = trpcReact.system.memoryUsage.useQuery(undefined, {
		// Sometimes we won't be able to get disk usage, so prevent retry
		retry: false,
		// We do want refetching to happen on a schedule though
		refetchInterval: options.poll ? 1000 : undefined,
	})

	const transformed = trpcMemoryToLocal(memoryQ.data)

	return {
		data: memoryQ.data,
		isLoading: memoryQ.isLoading,
		//
		...transformed,
		apps: sort(
			[
				...(memoryQ.data?.apps ?? []),
				{
					id: 'umbreld-system',
					used: memoryQ.data?.system ?? 0,
				},
			],
			(a, b) => b.used - a.used,
		),
		isMemoryLow: isMemoryLow({size: transformed?.size, used: transformed?.used}),
	}
}

export function useSystemMemoryForUi(options: {poll?: boolean} = {}) {
	const {isLoading, used, size, available, isMemoryLow} = useSystemMemory({poll: options.poll})

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
		isMemoryLow,
	} as const
}

export function useMemoryForUi(options: {poll?: boolean} = {}) {
	const {isLoading, used, size, available, isMemoryLow, apps} = useMemory({poll: options.poll})

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
		isMemoryLow,
		apps,
	} as const
}
