import {describe, expect, test} from 'vitest'

import {formatItemName} from './format-filesystem-name'

describe('formatItemName', () => {
	test('leaves names within the budget alone', () => {
		expect(formatItemName({name: 'report.pdf', maxLength: 12})).toBe('report.pdf')
	})

	test('keeps the start, the end and the extension of a long name', () => {
		expect(formatItemName({name: 'very-long-document-name.txt', maxLength: 16})).toBe('very-lo…name.txt')
	})

	test('never splits an emoji in two', () => {
		expect(formatItemName({name: '🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉 party.png', maxLength: 12})).toBe('🎉🎉🎉🎉🎉…ty.png')
	})

	test('keeps a name short when its extension leaves no room for an end', () => {
		expect(formatItemName({name: 'installer-for-macos.download', maxLength: 12})).toBe('in….download')
		expect(formatItemName({name: 'a-long-name.averyverylongextension', maxLength: 12})).toBe(
			'a….averyverylongextension',
		)
	})
})
