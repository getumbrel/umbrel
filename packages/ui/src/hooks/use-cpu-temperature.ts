import {trpcReact} from '@/trpc/trpc'

export function useCpuTemperature() {
	const cpuTemperatureQ = trpcReact.system.cpuTemperature.useQuery(undefined, {
		// Sometimes we won't be able to get CPU temperature, so prevent retry
		retry: false,
		// We do want refetching to happen on a schedule though
		refetchInterval: 5_000,
	})

	const temperature = cpuTemperatureQ.data?.temperature
	const warning = cpuTemperatureQ.data?.warning

	return {
		temperature,
		warning,
		isLoading: cpuTemperatureQ.isLoading,
		error: cpuTemperatureQ.error,
	}
}
