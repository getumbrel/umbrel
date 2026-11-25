import {expect, test} from 'vitest'

import {shouldShowWhatsNew} from '@/routes/whats-new'

test('shows after updating from a version before umbrelOS 2.1 Beta 2', () => {
	expect(shouldShowWhatsNew('1.5.0')).toBe(true)
	expect(shouldShowWhatsNew('2.0.1')).toBe(true)
	expect(shouldShowWhatsNew('2.0.2')).toBe(true)
	expect(shouldShowWhatsNew('2.1.0-beta.1')).toBe(true)
})

test('does not show again once seen', () => {
	expect(shouldShowWhatsNew('2.1.0-beta.2')).toBe(false)
	expect(shouldShowWhatsNew('2.1.0-beta.3')).toBe(false)
	expect(shouldShowWhatsNew('2.1.0')).toBe(false)
	expect(shouldShowWhatsNew('2.1.1')).toBe(false)
})

test('does not show without a previous version', () => {
	expect(shouldShowWhatsNew(undefined)).toBe(false)
	expect(shouldShowWhatsNew('')).toBe(false)
	expect(shouldShowWhatsNew('not a version')).toBe(false)
})
