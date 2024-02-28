import {UNKNOWN} from '@/constants'
import {t} from '@/utils/i18n'

export const TEMP_TOO_COLD = -40
export const TEMP_THROTTLE = 80 // 100 for Umbrel Home
export const TEMP_TOO_HOT = 85 // 105 for Umbrel Home

export const TEMP_NORMAL_MIN = TEMP_TOO_COLD
export const TEMP_NORMAL_MAX = TEMP_THROTTLE

export function celciusToFahrenheit(tempInCelcius?: number) {
	if (tempInCelcius === undefined) return undefined
	return Math.round((tempInCelcius * 9) / 5 + 32)
}

export function tempToColor(tempInCelcius?: number) {
	const temp = tempInCelcius
	if (temp === undefined) return '#CCCCCC'

	if (temp < TEMP_TOO_COLD) {
		return '#6BF1E9'
	}
	if (temp >= TEMP_NORMAL_MIN && temp <= TEMP_NORMAL_MAX) {
		return '#96F16B'
	}
	if (temp > TEMP_NORMAL_MAX && temp <= TEMP_TOO_HOT) {
		return '#E6E953'
	}
	if (temp > TEMP_TOO_HOT) {
		return '#F45252'
	}
	return '#CCCCCC'
}

export function tempToMessage(tempInCelcius?: number) {
	if (tempInCelcius === undefined) return UNKNOWN()

	const temp = tempInCelcius

	if (temp < TEMP_TOO_COLD) {
		return t('temp.too-cold')
	}
	if (temp >= TEMP_NORMAL_MIN && temp <= TEMP_NORMAL_MAX) {
		return t('temp.normal')
	}
	if (temp > TEMP_NORMAL_MAX && temp <= TEMP_TOO_HOT) {
		return t('temp.warm')
	}
	if (temp > TEMP_TOO_HOT) {
		return t('temp.dangerously-hot')
	}
	return t('temp.normal')
}
