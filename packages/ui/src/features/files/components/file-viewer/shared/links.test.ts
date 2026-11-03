import {expect, test} from 'vitest'

import {safeHref} from './links'

test('web and mail links open, as the parsed URL', () => {
	expect(safeHref('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d')
	expect(safeHref('  HTTP://Example.COM  ')).toBe('http://example.com/')
	expect(safeHref('https://example.com/a b')).toBe('https://example.com/a%20b')
	expect(safeHref('mailto:someone@example.com')).toBe('mailto:someone@example.com')
})

test('anything else is no link', () => {
	for (const target of [
		undefined,
		'',
		'javascript:alert(1)',
		'java\nscript:alert(1)',
		' java\tscript:alert(1)',
		' JavaScript:alert(1)',
		'vbscript:msgbox(1)',
		'data:text/html,<script>alert(1)</script>',
		'file:///etc/passwd',
		'ftp://example.com/',
		'tel:+15555550100',
		'slide2.xml',
		'//evil.com',
		'#bookmark',
		'https://',
		'http://exa mple.com/',
	])
		expect(safeHref(target), target).toBeUndefined()
})
