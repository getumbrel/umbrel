import {UmbrelHostEnvironment} from '@/constants'
import {trpcReact} from '@/trpc/trpc'

export function useDeviceInfo() {
	const osQ = trpcReact.system.version.useQuery()
	const deviceInfoQ = trpcReact.system.device.useQuery()

	const isLoading = osQ.isLoading || deviceInfoQ.isLoading
	if (isLoading) {
		return {isLoading: true} as const
	}

	// TODO: Add umbrel host environment
	const umbrelHostEnvironment: UmbrelHostEnvironment | undefined = undefined

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
