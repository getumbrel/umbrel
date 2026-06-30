import {describe, expect, test} from 'vitest'

import {buildWebdavRemote} from './rclone.js'

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
})
