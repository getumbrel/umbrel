import {UmbrelHostEnvironment} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export const UNKNOWN = () => t('unknown')

export const SHEET_HEADER_ID = 'sheet-header-root-id'
export const SETTINGS_SYSTEM_CARDS_ID = 'settings-system-cards'

export const hostEnvironmentMap = {
	'umbrel-home': {
		title: 'Umbrel Home',
		icon: '/figma-exports/umbrel-home.svg',
	},
	'raspberry-pi': {
		title: 'Raspberry Pi',
		icon: '/figma-exports/pi.svg',
	},
	linux: {
		title: 'Linux',
		icon: '/figma-exports/tux.svg',
	},
} satisfies Record<UmbrelHostEnvironment, {title: string; icon: string}>
