import {LOADING_DASH} from '@/constants'
import {t} from '@/utils/i18n'

export function celciusToFahrenheit(tempInCelcius?: number) {
	if (tempInCelcius === undefined) return undefined
	return Math.round((tempInCelcius * 9) / 5 + 32)
}

export function tempWarningToColor(warning?: string) {
	if (warning === undefined) return '#CCCCCC'

	if (warning === 'warm') {
		return '#E6E953'
	}
	if (warning === 'hot') {
		return '#F45252'
	}
	return '#96F16B'
}

export function tempWarningToMessage(warning?: string) {
	if (warning === undefined) return LOADING_DASH

	if (warning === 'normal') {
		return t('temp.normal')
	}
	if (warning === 'warm') {
		return t('temp.warm')
	}
	if (warning === 'hot') {
		return t('temp.dangerously-hot')
	}
	return t('temp.normal')
}
