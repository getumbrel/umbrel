import {UNKNOWN} from '@/constants'
import {t} from '@/utils/i18n'

type Thresholds = {
	cold: number
	throttle: number
	hot: number
}

/**
 * The `nuc` type is for Intel NUCs, and the `pi` type is for Raspberry Pis.
 * The Umbrel Home is a `nuc`, and most custom Umbrel setups would be that.
 * Thresholds are in degrees Celsius.
 * https://discord.com/channels/936693236339183716/1212119508521590915/1212309347099484191
 */
export const cpuTypes = ['pi', 'nuc'] as const

export type CpuType = (typeof cpuTypes)[number]

export const TEMP_THRESHOLDS = {
	pi: {
		cold: -40,
		throttle: 80,
		hot: 85,
	},
	nuc: {
		cold: -40,
		throttle: 100,
		hot: 105,
	},
} as const satisfies Record<CpuType, Thresholds>

export function celciusToFahrenheit(tempInCelcius?: number) {
	if (tempInCelcius === undefined) return undefined
	return Math.round((tempInCelcius * 9) / 5 + 32)
}

export function tempToColor(cpuType: CpuType, tempInCelcius?: number) {
	const thresholds = TEMP_THRESHOLDS[cpuType]
	if (tempInCelcius === undefined) return '#CCCCCC'

	if (tempInCelcius < thresholds.cold) {
		return '#6BF1E9'
	}
	if (tempInCelcius >= thresholds.cold && tempInCelcius <= thresholds.throttle) {
		return '#96F16B'
	}
	if (tempInCelcius > thresholds.throttle && tempInCelcius <= thresholds.hot) {
		return '#E6E953'
	}
	if (tempInCelcius > thresholds.hot) {
		return '#F45252'
	}
	return '#CCCCCC'
}

export function tempToMessage(cpuType: CpuType, tempInCelcius?: number) {
	if (tempInCelcius === undefined) return UNKNOWN()

	const thresholds = TEMP_THRESHOLDS[cpuType]
	if (tempInCelcius < thresholds.cold) {
		return t('temp.too-cold')
	}
	if (tempInCelcius >= thresholds.cold && tempInCelcius <= thresholds.throttle) {
		return t('temp.normal')
	}
	if (tempInCelcius > thresholds.throttle && tempInCelcius <= thresholds.hot) {
		return t('temp.warm')
	}
	if (tempInCelcius > thresholds.hot) {
		return t('temp.dangerously-hot')
	}
	return t('temp.normal')
}
