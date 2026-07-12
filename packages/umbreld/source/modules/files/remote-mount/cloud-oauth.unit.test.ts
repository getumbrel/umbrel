import {describe, expect, test} from 'vitest'

import {parseCloudAuthToken, parseCloudAuthUrl} from './cloud-oauth.js'

describe('parseCloudAuthUrl', () => {
	test('parses rclone authorize link from stderr', () => {
		const output = `2024/01/01 12:00:00 NOTICE: Please go to the following link: http://127.0.0.1:53682/auth?state=abc123
Log in and authorize rclone for access`
		expect(parseCloudAuthUrl(output)).toBe('http://127.0.0.1:53682/auth?state=abc123')
	})

	test('parses localhost callback URL directly', () => {
		expect(parseCloudAuthUrl('Open http://127.0.0.1:53682/auth?state=xyz in your browser')).toBe(
			'http://127.0.0.1:53682/auth?state=xyz',
		)
	})

	test('strips trailing colon from URL', () => {
		expect(parseCloudAuthUrl('Please go to the following link: http://127.0.0.1:53682/auth?state=abc:')).toBe(
			'http://127.0.0.1:53682/auth?state=abc',
		)
	})

	test('throws when URL is missing', () => {
		expect(() => parseCloudAuthUrl('waiting for authorization')).toThrow('[cloud-auth-url-not-found]')
	})
})

describe('parseCloudAuthToken', () => {
	test('returns trimmed JSON stdout', () => {
		const token = '{"access_token":"abc","token_type":"bearer","expiry":"2026-01-01T00:00:00Z"}'
		expect(parseCloudAuthToken(`  ${token}  `)).toBe(token)
	})

	test('extracts JSON object from mixed output', () => {
		const token = '{"access_token":"abc","token_type":"bearer"}'
		expect(parseCloudAuthToken(`authorized\n${token}\n`)).toBe(token)
	})

	test('throws when token JSON is missing', () => {
		expect(() => parseCloudAuthToken('authorization failed')).toThrow('[cloud-auth-token-not-found]')
	})
})
