import {hostEnvironmentMap, LOADING_DASH, UmbrelHostEnvironment, UNKNOWN} from '@/constants'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

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
				device?: string
				modelNumber?: string
				serialNumber?: string
				osVersionName?: string
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

	const umbrelHostEnvironment: UmbrelHostEnvironment | undefined = deviceInfoToHostEnvironment(deviceInfoQ.data)

	const device = deviceInfoQ.data?.device
	const modelNumber = deviceInfoQ.data?.model
	const serialNumber = deviceInfoQ.data?.serial
	const osVersionName = osQ.data?.name

	return {
		isLoading,
		data: {
			umbrelHostEnvironment,
			device,
			modelNumber,
			serialNumber,
			osVersionName,
		},
		uiData: umbrelHostEnvironment
			? {
					icon: hostEnvironmentMap[umbrelHostEnvironment].icon,
					title: device || LOADING_DASH,
				}
			: {
					icon: undefined,
					title: UNKNOWN(),
				},
	}
}

type DeviceInfo = RouterOutput['system']['device']

function deviceInfoToHostEnvironment(deviceInfo?: DeviceInfo): UmbrelHostEnvironment | undefined {
	if (!deviceInfo) {
		return undefined
	}

	if (deviceInfo.productName.toLowerCase().includes('umbrel home')) {
		return 'umbrel-home'
	}

	if (deviceInfo.productName.toLowerCase().includes('raspberry pi')) {
		return 'raspberry-pi'
	}

	if (deviceInfo.productName.toLowerCase().includes('docker')) {
		return 'docker-container'
	}

	// We return unknown and render a generic server icon
	return 'unknown'
}
