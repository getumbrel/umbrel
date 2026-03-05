import {UmbrelHostEnvironment} from '@/constants'
import {useDeviceInfo} from '@/hooks/use-device-info'

type OnboardingDevice = {
	showDevice: boolean
	image: string | null
	imageClassName: string
	name: string | null
}

const deviceConfig: Partial<
	Record<
		UmbrelHostEnvironment,
		{
			image: string
			imageClassName: string
			name: string
		}
	>
> = {
	'umbrel-pro': {
		image: '/assets/onboarding/pro-front.webp',
		imageClassName: 'w-64 md:w-96',
		name: 'Umbrel Pro',
	},
	'umbrel-home': {
		image: '/assets/onboarding/home-front.webp',
		imageClassName: 'w-48 md:w-64',
		name: 'Umbrel Home',
	},
}

const DEFAULT: OnboardingDevice = {
	showDevice: false,
	image: null,
	imageClassName: '',
	name: null,
}

export function useOnboardingDevice(): OnboardingDevice {
	const {isLoading, data} = useDeviceInfo()

	if (isLoading || !data?.umbrelHostEnvironment) return DEFAULT

	const config = deviceConfig[data.umbrelHostEnvironment]
	if (!config) return DEFAULT

	return {
		showDevice: true,
		image: config.image,
		imageClassName: config.imageClassName,
		name: config.name,
	}
}
