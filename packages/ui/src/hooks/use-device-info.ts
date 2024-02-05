import {trpcReact} from '@/trpc/trpc'

export function useDeviceInfo() {
	const osQ = trpcReact.system.version.useQuery()
	const deviceInfoQ = trpcReact.system.device.useQuery()

	const isLoading = osQ.isLoading || deviceInfoQ.isLoading
	if (isLoading) {
		return {isLoading: true} as const
	}

	const umbrelHostEnvironment = deviceInfoQ.data?.umbrelHostEnvironment
	const modelNumber = deviceInfoQ.data?.model
	const serialNumber = deviceInfoQ.data?.serial
	const osVersion = osQ.data

	return {
		isLoading,
		data: {
			umbrelHostEnvironment,
			modelNumber,
			serialNumber,
			osVersion,
		},
	}
}
