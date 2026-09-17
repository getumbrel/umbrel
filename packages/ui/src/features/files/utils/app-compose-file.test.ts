import {describe, expect, test, vi} from 'vitest'

import {getAppComposeFile} from './app-compose-file'

// The real constants module pulls in thumbnails and browser-only globals
vi.mock('@/features/files/constants', () => ({APPS_PATH: '/Apps'}))

describe('getAppComposeFile', () => {
	test("matches compose files directly in an app's folder", () => {
		expect(getAppComposeFile('/Apps/bitcoin/docker-compose.yml')).toStrictEqual({appId: 'bitcoin', generated: false})
		expect(getAppComposeFile('/Apps/bitcoin/docker-compose.override.yaml')).toStrictEqual({
			appId: 'bitcoin',
			generated: false,
		})
	})

	test('flags the compose files umbrelOS generates', () => {
		expect(getAppComposeFile('/Apps/bitcoin/docker-compose.umbreld.yml')).toStrictEqual({
			appId: 'bitcoin',
			generated: true,
		})
		expect(getAppComposeFile('/Apps/bitcoin/docker-compose.umbrel-user-settings.yml')).toStrictEqual({
			appId: 'bitcoin',
			generated: true,
		})
	})

	test.each([
		'/Apps/bitcoin/umbrel-app.yml',
		'/Apps/bitcoin/data/docker-compose.yml',
		'/Apps/docker-compose.yml',
		'/Apps/bitcoin',
		'/Home/docker-compose.yml',
		'/Backups/umbrel/Apps/bitcoin/docker-compose.yml',
		'/AppsArchive/bitcoin/docker-compose.yml',
	])('ignores %s', (path) => {
		expect(getAppComposeFile(path)).toBeNull()
	})
})
