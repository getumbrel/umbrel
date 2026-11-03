import i18next from 'i18next'
import {afterEach, describe, expect, it} from 'vitest'

import {secondsToEta} from '@/utils/seconds-to-eta'

const language = i18next.language

describe('secondsToEta', () => {
	afterEach(() => {
		i18next.language = language
	})

	it('reads the time left in the largest units that fit', () => {
		i18next.language = 'en'
		expect(secondsToEta(45)).toBe('45 sec')
		expect(secondsToEta(12 * 60)).toBe('12 min')
		expect(secondsToEta(90 * 60)).toBe('1 hr, 30 min')
		expect(secondsToEta(2 * 3600)).toBe('2 hr')
	})

	it('shows only the hours past an hour when compact', () => {
		i18next.language = 'en'
		expect(secondsToEta(90 * 60, {compact: true})).toBe('2 hr')
		expect(secondsToEta(70 * 60, {compact: true})).toBe('1 hr')
		expect(secondsToEta(12 * 60, {compact: true})).toBe('12 min')
	})

	it('rounds before choosing the unit', () => {
		i18next.language = 'en'
		expect(secondsToEta(59.6)).toBe('1 min')
		expect(secondsToEta(3599)).toBe('1 hr')
	})

	it('speaks the UI language', () => {
		i18next.language = 'ko'
		expect(secondsToEta(90 * 60)).toBe('1시간 30분')
		i18next.language = 'de'
		expect(secondsToEta(90 * 60)).toBe('1 Std., 30 Min.')
	})

	it('shows a dash when there is no estimate', () => {
		expect(secondsToEta(undefined)).toBe('-')
		expect(secondsToEta(0)).toBe('-')
		expect(secondsToEta(Infinity)).toBe('-')
	})
})
