import {deviceMap, UNKNOWN} from '@/constants'
import {trpcReact} from '@/trpc/trpc'

export function useDeviceInfo() {
	const deviceInfoQ = trpcReact.system.deviceInfo.useQuery()
	return {
		isLoading: deviceInfoQ.isLoading,
		device: deviceInfoQ.data?.device ? deviceMap[deviceInfoQ.data?.device].title : UNKNOWN(),
		modelNumber: deviceInfoQ.data?.modelNumber || UNKNOWN(),
		serialNumber: deviceInfoQ.data?.serialNumber || UNKNOWN(),
	}
}
