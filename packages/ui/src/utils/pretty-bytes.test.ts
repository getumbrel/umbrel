import {describe, expect, test} from 'vitest'

import {maybePrettyBytes} from './pretty-bytes'

describe('maybePrettyBytes', () => {
	test('moves up a unit instead of showing four digits', () => {
		expect(maybePrettyBytes(999_999_999_999, 'en')).toBe('1 TB')
		expect(maybePrettyBytes(999_500_000_000, 'en')).toBe('1 TB')
		expect(maybePrettyBytes(999_499_999_999, 'en')).toBe('999 GB')
	})

	test('keeps three significant digits', () => {
		expect(maybePrettyBytes(1_234_567_890, 'en')).toBe('1.23 GB')
		expect(maybePrettyBytes(512, 'en')).toBe('512 B')
		expect(maybePrettyBytes(0, 'en')).toBe('0 B')
	})
})
