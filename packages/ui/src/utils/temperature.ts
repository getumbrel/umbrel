import {LOADING_DASH} from '@/constants'
import {t} from '@/utils/i18n'

export function celciusToFahrenheit(temperatureInCelcius?: number) {
	if (temperatureInCelcius === undefined) return undefined
	return Math.round((temperatureInCelcius * 9) / 5 + 32)
}

export function temperatureWarningToColor(warning?: string) {
	if (warning === undefined) return '#CCCCCC'

	if (warning === 'warm') {
		return '#E6E953'
	}
	if (warning === 'hot') {
		return '#F45252'
	}
	return '#96F16B'
}

export function temperatureWarningToMessage(warning?: string) {
	if (warning === undefined) return LOADING_DASH

	if (warning === 'normal') {
		return t('temperature.normal')
	}
	if (warning === 'warm') {
		return t('temperature.warm')
	}
	if (warning === 'hot') {
		return t('temperature.dangerously-hot')
	}
	return t('temperature.normal')
}
