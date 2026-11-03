import {describe, expect, it} from 'vitest'

import {capitalizeDate} from '@/utils/date-time'

describe('capitalizeDate', () => {
	it('starts a date that Intl writes in lowercase with a capital', () => {
		expect(capitalizeDate('октябрь 2026 г.', 'ru')).toBe('Октябрь 2026 г.')
		expect(capitalizeDate('miércoles, 14 de octubre de 2026', 'es')).toBe('Miércoles, 14 de octubre de 2026')
	})

	it('leaves a date that starts with a number, a capital or an uncased script alone', () => {
		expect(capitalizeDate('2026. október 14.', 'hu')).toBe('2026. október 14.')
		expect(capitalizeDate('October 2026', 'en')).toBe('October 2026')
		expect(capitalizeDate('2026年10月', 'ja')).toBe('2026年10月')
	})
})
