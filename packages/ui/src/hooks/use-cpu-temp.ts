import {trpcReact} from '@/trpc/trpc'
import {isCpuTooHot} from '@/utils/system'

export function useCpuTemp() {
	const cpuTempQ = trpcReact.system.cpuTemperature.useQuery(undefined, {
		// Sometimes we won't be able to get CPU temp, so prevent retry
		retry: false,
		// We do want refetching to happen on a schedule though
		refetchInterval: 5_000,
	})

	const temp = cpuTempQ.data

	return {
		temp,
		isLoading: cpuTempQ.isLoading,
		isHot: isCpuTooHot(temp),
		error: cpuTempQ.error,
	}
}
