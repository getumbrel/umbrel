import {describe, expect, it} from 'vitest'

import {formatItemName} from '@/features/files/utils/format-filesystem-name'

describe('formatItemName', () => {
	it('leaves names that fit alone', () => {
		expect(formatItemName({name: 'Notes.txt'})).toBe('Notes.txt')
		expect(formatItemName({name: '確定申告.pdf'})).toBe('確定申告.pdf')
	})

	it('middle-truncates long names and keeps the extension', () => {
		expect(formatItemName({name: 'quarterly-financial-report-final-version.xlsx'})).toBe(
			'quarterly-finan…l-version.xlsx',
		)
		expect(formatItemName({name: 'very-long-document-name.txt', maxLength: 16})).toBe('very-lo…name.txt')
	})

	it('keeps the first character when the extension leaves no room for an end', () => {
		expect(formatItemName({name: 'installer-for-macos.download', maxLength: 12})).toBe('in….download')
		expect(formatItemName({name: 'a-long-name.averyverylongextension', maxLength: 12})).toBe(
			'a….averyverylongextension',
		)
	})

	it('counts Chinese, Japanese and Korean characters double, so their names keep the extension', () => {
		const japanese = formatItemName({name: '令和八年度の確定申告に必要な書類一覧表まとめ.pdf'})
		expect(japanese).toBe('令和八年度の確…覧表まとめ.pdf')
		const chinese = formatItemName({name: '年度财务报告与审计意见书最终版本.xlsx'})
		expect(chinese.endsWith('.xlsx')).toBe(true)
		// About as wide as the 30-character Latin budget: 2 per character plus the extension
		expect(Array.from(chinese.replace('.xlsx', '')).length).toBeLessThanOrEqual(13)
	})

	it('never cuts an emoji apart, and counts emoji double too', () => {
		const foxes = formatItemName({name: '🦊'.repeat(40) + '.png'})
		expect(foxes).toBe('🦊'.repeat(7) + '…' + '🦊'.repeat(5) + '.png')

		const flags = formatItemName({name: '🇩🇪'.repeat(20) + '.png'})
		expect(flags).toBe('🇩🇪'.repeat(7) + '…' + '🇩🇪'.repeat(5) + '.png')

		const family = formatItemName({name: 'Family ' + '👨‍👩‍👧'.repeat(12) + '.jpg'})
		expect(family.replace(/👨‍👩‍👧/g, '')).toBe('Family ….jpg')
		expect(family.endsWith('👨‍👩‍👧.jpg')).toBe(true)
	})
})
