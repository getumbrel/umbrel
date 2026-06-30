import nodePath from 'node:path'

import {expect, beforeEach, afterEach, describe, test} from 'vitest'

import fse from 'fs-extra'
import getPort from 'get-port'
import {execa, type ExecaChildProcess} from 'execa'
import pRetry from 'p-retry'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
let webdavServer: ExecaChildProcess | undefined
let webdavPort = 0
let webdavDirectory = ''

const hasRclone = await execa('command', ['-v', 'rclone'], {reject: false})
	.then((result) => result.exitCode === 0)
	.catch(() => false)

describe.skipIf(!hasRclone)('WebDAV network storage via rclone', () => {
	beforeEach(async () => {
		umbreld = await createTestUmbreld({autoLogin: true})
		webdavDirectory = nodePath.join(umbreld.instance.dataDirectory, 'webdav-root')
		await fse.mkdir(webdavDirectory)
		await fse.writeFile(nodePath.join(webdavDirectory, 'remote-file.txt'), 'webdav works')

		webdavPort = await getPort()
		webdavServer = execa(
			'rclone',
			[
				'serve',
				'webdav',
				webdavDirectory,
				'--addr',
				`127.0.0.1:${webdavPort}`,
				'--user',
				'umbrel',
				'--pass',
				'umbrel-test-pass',
			],
			{stdio: 'ignore'},
		)

		await pRetry(
			async () => {
				const response = await fetch(`http://127.0.0.1:${webdavPort}/`)
				if (!response.ok) throw new Error('WebDAV server not ready')
			},
			{retries: 20, minTimeout: 250, factor: 1},
		)
	})

	afterEach(async () => {
		webdavServer?.kill('SIGTERM', {forceKillAfterTimeout: 2000})
		webdavServer = undefined
		await umbreld?.cleanup()
	})

	test('adds and mounts a WebDAV share', async () => {
		const mountPath = await umbreld.client.files.addNetworkShare.mutate({
			protocol: 'webdav',
			url: `http://127.0.0.1:${webdavPort}/`,
			username: 'umbrel',
			password: 'umbrel-test-pass',
			label: 'Test WebDAV',
		})

		expect(mountPath).toBe('/Network/127.0.0.1/Test WebDAV')

		const shares = await umbreld.client.files.listNetworkShares.query()
		expect(shares).toHaveLength(1)
		expect(shares[0]).toMatchObject({
			protocol: 'webdav',
			host: '127.0.0.1',
			share: 'Test WebDAV',
			mountPath,
			url: `http://127.0.0.1:${webdavPort}/`,
			isMounted: true,
		})

		const listing = await umbreld.client.files.list.query({path: mountPath})
		expect(listing.files.map((file) => file.name)).toContain('remote-file.txt')
	})
})
