import {t} from '@/utils/i18n'

export function greetingMessage(name: string) {
	const greetingMap = {
		morning: t('desktop.greeting.morning', {name}),
		afternoon: t('desktop.greeting.afternoon', {name}),
		evening: t('desktop.greeting.evening', {name}),
	}

	return greetingMap[getPartofDay()] + '.'
}

function getPartofDay() {
	const today = new Date()
	const curHr = today.getHours()

	if (curHr < 12) {
		return 'morning'
	} else if (curHr < 18) {
		return 'afternoon'
	} else {
		return 'evening'
	}
}
