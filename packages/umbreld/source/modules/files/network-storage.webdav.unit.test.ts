import {describe, expect, test} from 'vitest'

import {getWebdavHostKey} from './network-storage.js'

describe('getWebdavHostKey', () => {
	test('returns hostname for default ports', () => {
		expect(getWebdavHostKey('https://nas.local/dav')).toBe('nas.local')
		expect(getWebdavHostKey('http://192.168.1.10/dav')).toBe('192.168.1.10')
	})

	test('includes non-default port in host key', () => {
		expect(getWebdavHostKey('https://192.168.1.10:5006/dav')).toBe('192.168.1.10-5006')
		expect(getWebdavHostKey('http://nas.local:8080/remote.php/dav')).toBe('nas.local-8080')
	})
})
