import {trpcReact} from '@/trpc/trpc'

export function useDeviceInfo() {
	const osQ = trpcReact.system.osVersion.useQuery()
	const deviceInfoQ = trpcReact.system.deviceInfo.useQuery()

	const isLoading = osQ.isLoading || deviceInfoQ.isLoading
	if (isLoading) {
		return {isLoading: true} as const
	}

	const device = deviceInfoQ.data?.device
	const modelNumber = deviceInfoQ.data?.modelNumber
	const serialNumber = deviceInfoQ.data?.serialNumber
	const osVersion = osQ.data

	return {
		isLoading,
		data: {
			device,
			modelNumber,
			serialNumber,
			osVersion,
		},
	}
}
