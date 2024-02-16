import {hostEnvironmentMap, LOADING_DASH, UmbrelHostEnvironment, UNKNOWN} from '@/constants'
import {trpcReact} from '@/trpc/trpc'

type UiHostInfo = {
	icon?: string
	title: string
}

type DeviceInfoT =
	| {
			isLoading: true
			data: undefined
			uiData: UiHostInfo
	  }
	| {
			isLoading: false
			data: {
				umbrelHostEnvironment?: UmbrelHostEnvironment
				modelNumber?: string
				serialNumber?: string
				osVersion?: string
			}
			uiData: UiHostInfo
	  }

export function useDeviceInfo(): DeviceInfoT {
	const osQ = trpcReact.system.version.useQuery()
	const deviceInfoQ = trpcReact.system.device.useQuery()

	const isLoading = osQ.isLoading || deviceInfoQ.isLoading
	if (isLoading) {
		return {
			isLoading: true,
			data: undefined,
			uiData: {
				icon: undefined,
				title: LOADING_DASH,
			},
		} as const
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
		uiData: umbrelHostEnvironment
			? hostEnvironmentMap[umbrelHostEnvironment]
			: {
					icon: undefined,
					title: UNKNOWN(),
			  },
	}
}
