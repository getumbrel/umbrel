import {t} from '@/utils/i18n'

export const UNKNOWN = () => t('unknown')
// This is an en dash (U+2013)
export const LOADING_DASH = '–'

export const SETTINGS_SYSTEM_CARDS_ID = 'settings-system-cards'

export const hostEnvironments = ['umbrel-pro', 'umbrel-home', 'raspberry-pi', 'docker-container', 'unknown'] as const
export type UmbrelHostEnvironment = (typeof hostEnvironments)[number]

export const hostEnvironmentMap = {
	'umbrel-pro': {
		icon: '/assets/system-umbrel-pro.webp',
	},
	'umbrel-home': {
		icon: '/assets/system-umbrel-home.png',
	},
	'raspberry-pi': {
		icon: '/assets/system-pi.svg',
	},
	'docker-container': {
		icon: '/assets/system-docker.svg',
	},
	unknown: {
		icon: '/assets/system-generic-device.svg',
	},
} satisfies Record<
	UmbrelHostEnvironment,
	{
		icon?: string
	}
>
