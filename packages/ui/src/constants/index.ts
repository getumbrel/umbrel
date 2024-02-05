import {UmbrelHostEnvironment} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export const UNKNOWN = () => t('unknown')

export const SETTINGS_SYSTEM_CARDS_ID = 'settings-system-cards'

export const hostEnvironmentMap = {
	'umbrel-home': {
		title: 'Umbrel Home',
		icon: '/figma-exports/system-umbrel-home.png',
	},
	'raspberry-pi': {
		title: 'Raspberry Pi',
		icon: '/figma-exports/system-pi.svg',
	},
	linux: {
		title: 'Linux',
		icon: '/figma-exports/system-tux.svg',
	},
} satisfies Record<UmbrelHostEnvironment, {title: string; icon: string}>
