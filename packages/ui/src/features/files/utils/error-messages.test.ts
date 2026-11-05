import {describe, expect, test, vi} from 'vitest'

import {getFilesApiErrorMessage, getFilesErrorMessage} from './error-messages'

vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))

describe('getFilesApiErrorMessage', () => {
	test('translates a structured Files API error', () => {
		expect(getFilesApiErrorMessage(JSON.stringify({error: '[not-enough-space]'}), 'fallback')).toBe(
			'files-backend-error.not-enough-space',
		)
	})

	test.each(['not json', JSON.stringify({error: true}), JSON.stringify(null)])(
		'falls back when the response has no string error: %s',
		(responseText) => {
			expect(getFilesApiErrorMessage(responseText, 'fallback')).toBe('fallback')
		},
	)
})

describe('getFilesErrorMessage', () => {
	test('translates a forbidden path instead of showing the raw code and path', () => {
		expect(getFilesErrorMessage("[forbidden] '/Home'")).toBe('files-backend-error.forbidden')
	})
})
