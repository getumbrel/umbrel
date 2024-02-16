import {t} from '@/utils/i18n'

export const UNKNOWN = () => t('unknown')
// This is an en dash (U+2013)
export const LOADING_DASH = '–'

export const SETTINGS_SYSTEM_CARDS_ID = 'settings-system-cards'

const hostEnvironments = ['umbrel-home', 'raspberry-pi', 'linux'] as const
export type UmbrelHostEnvironment = (typeof hostEnvironments)[number]

// NOTE: ensure this is in sync with the `hostEnvironments` array
;[t('umbrel-home'), t('raspberry-pi'), t('linux')]

export const hostEnvironmentMap = {
	'umbrel-home': {
		icon: '/figma-exports/system-umbrel-home.png',
	},
	'raspberry-pi': {
		icon: '/figma-exports/system-pi.svg',
	},
	linux: {
		icon: '/figma-exports/system-tux.svg',
	},
} satisfies Record<
	UmbrelHostEnvironment,
	{
		icon?: string
	}
>
