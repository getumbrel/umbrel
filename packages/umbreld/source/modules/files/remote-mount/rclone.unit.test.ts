import {describe, expect, test} from 'vitest'

import {buildWebdavRemote} from './rclone.js'
import {detectWebdavVendor} from './webdav.js'

describe('buildWebdavRemote', () => {
	test('builds a webdav remote with certificate checks disabled for self-signed NAS certs', () => {
		const remote = buildWebdavRemote('umbrel-test', {
			url: 'https://nas.local/dav',
			username: 'admin',
			obscuredPassword: 'obscured-pass',
		})

		expect(remote).toEqual({
			name: 'umbrel-test',
			type: 'webdav',
			options: {
				url: 'https://nas.local/dav',
				vendor: 'other',
				user: 'admin',
				pass: 'obscured-pass',
				no_check_certificate: 'true',
			},
		})
	})

	test('uses nextcloud vendor when specified', () => {
		const remote = buildWebdavRemote('umbrel-nc', {
			url: 'https://cloud.example.com/remote.php/dav/files/user',
			username: 'user',
			obscuredPassword: 'obscured-pass',
			vendor: 'nextcloud',
		})

		expect(remote.options.vendor).toBe('nextcloud')
	})
})

describe('detectWebdavVendor', () => {
	test('detects nextcloud URLs', () => {
		expect(detectWebdavVendor('https://cloud.example.com/remote.php/dav/files/admin')).toBe('nextcloud')
		expect(detectWebdavVendor('https://nextcloud.local/')).toBe('nextcloud')
	})

	test('defaults to other for generic webdav URLs', () => {
		expect(detectWebdavVendor('https://192.168.1.10:5006/dav')).toBe('other')
	})
})
