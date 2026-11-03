import {describe, expect, test} from 'vitest'

import {formatFilesystemSize} from './format-filesystem-size'

describe('formatFilesystemSize', () => {
	test('distinguishes unknown sizes from known zero-byte sizes', () => {
		expect(formatFilesystemSize(undefined)).toBe('-')
		expect(formatFilesystemSize(null)).toBe('-')
		expect(formatFilesystemSize(0)).toBe('0 KB')
	})

	test('formats non-zero sizes as before', () => {
		expect(formatFilesystemSize(1_000)).toBe('1 KB')
	})

	test('moves up a unit instead of showing four digits', () => {
		expect(formatFilesystemSize(999_999_999)).toBe('1 GB')
		expect(formatFilesystemSize(999_499_999)).toBe('999 MB')
		expect(formatFilesystemSize(1_234_567)).toBe('1.23 MB')
	})
})
