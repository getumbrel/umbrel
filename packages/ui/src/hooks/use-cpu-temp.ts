import {useState} from 'react'

import {trpcReact} from '@/trpc/trpc'
import {isCpuTooCold, isCpuTooHot} from '@/utils/system'
import {CpuType} from '@/utils/temperature'

export function useCpuTemp() {
	const [enabled, setEnabled] = useState(true)
	const cpuTempQ = trpcReact.system.cpuTemperature.useQuery(undefined, {
		// Sometimes we won't be able to get CPU temp, so prevent retry
		retry: false,
		// We do want refetching to happen on a schedule though
		refetchInterval: 5_000,
		enabled,
		onError: () => {
			// Don't spam console with errors
			setEnabled(false)
		},
	})

	const temp = cpuTempQ.data

	const cpuType: CpuType = 'pi' // TODO: get from system

	return {
		temp,
		cpuType,
		isLoading: cpuTempQ.isLoading,
		isHot: isCpuTooHot(cpuType, temp),
		isCold: isCpuTooCold(cpuType, temp),
		error: cpuTempQ.error,
	}
}
