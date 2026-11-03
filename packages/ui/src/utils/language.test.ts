import {describe, expect, it} from 'vitest'

import {matchBrowserLanguage} from './language'

describe('matchBrowserLanguage', () => {
	it('matches a regional code to its base language', () => {
		expect(matchBrowserLanguage(['en-US'])).toBe('en')
		expect(matchBrowserLanguage(['pt-PT', 'en'])).toBe('pt')
	})

	it('prefers a regional variant we ship over its base language', () => {
		expect(matchBrowserLanguage(['pt-BR', 'pt'])).toBe('pt-BR')
		expect(matchBrowserLanguage(['pt-br'])).toBe('pt-BR')
	})

	it('picks Traditional Chinese for Taiwan, Hong Kong, Macau and Hant', () => {
		expect(matchBrowserLanguage(['zh-TW', 'zh', 'en-US'])).toBe('zh-TW')
		expect(matchBrowserLanguage(['zh-HK'])).toBe('zh-TW')
		expect(matchBrowserLanguage(['zh-MO'])).toBe('zh-TW')
		expect(matchBrowserLanguage(['zh-Hant'])).toBe('zh-TW')
		expect(matchBrowserLanguage(['zh-Hant-CN'])).toBe('zh-TW')
	})

	it('picks Simplified Chinese otherwise', () => {
		expect(matchBrowserLanguage(['zh'])).toBe('zh')
		expect(matchBrowserLanguage(['zh-CN'])).toBe('zh')
		expect(matchBrowserLanguage(['zh-Hans-TW'])).toBe('zh')
	})

	it('skips unsupported languages in favour of the next preference', () => {
		expect(matchBrowserLanguage(['xx-XX', 'ja-JP'])).toBe('ja')
		expect(matchBrowserLanguage(['xx'])).toBeUndefined()
	})
})
