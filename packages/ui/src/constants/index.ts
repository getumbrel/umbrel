import {t} from '@/utils/i18n'

export const UNKNOWN = () => t('unknown')
// This is an en dash (U+2013)
export const LOADING_DASH = '–'

export const SETTINGS_SYSTEM_CARDS_ID = 'settings-system-cards'

const hostEnvironments = ['umbrel-home', 'raspberry-pi', 'docker-container', 'unknown'] as const
export type UmbrelHostEnvironment = (typeof hostEnvironments)[number]

export const hostEnvironmentMap = {
	'umbrel-home': {
		icon: '/figma-exports/system-umbrel-home.png',
	},
	'raspberry-pi': {
		icon: '/figma-exports/system-pi.svg',
	},
	'docker-container': {
		icon: '/figma-exports/system-docker.svg',
	},
	unknown: {
		icon: '/figma-exports/system-generic-device.svg',
	},
} satisfies Record<
	UmbrelHostEnvironment,
	{
		icon?: string
	}
>
