import {t} from '@/utils/i18n'
import {firstNameFromFullName} from '@/utils/misc'

export function greetingMessage(name: string) {
	const firstName = firstNameFromFullName(name)

	const greetingMap = {
		morning: t('desktop.greeting.morning', {name: firstName}),
		afternoon: t('desktop.greeting.afternoon', {name: firstName}),
		evening: t('desktop.greeting.evening', {name: firstName}),
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
