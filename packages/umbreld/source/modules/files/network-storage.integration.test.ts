import nodePath from 'node:path'

import {expect, beforeEach, afterEach, describe, test} from 'vitest'

import fse from 'fs-extra'
import {delay} from 'es-toolkit'
import pRetry from 'p-retry'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

// Create a new umbreld instance for each test
beforeEach(async () => (umbreld = await createTestUmbreld({autoLogin: true})))
afterEach(async () => await umbreld.cleanup())

// Helper to setup a network share for testing
async function createNetworkShare(umbreld: Awaited<ReturnType<typeof createTestUmbreld>>, shareName: string) {
	// Create a test directory and add it as a local Samba share
	const testDirectory = `${umbreld.instance.dataDirectory}/home/${shareName}`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/test-file.txt`, 'test content')

	// Add directory as a Samba share
	await umbreld.client.files.addShare.mutate({path: `/Home/${shareName}`})

	// Get share password
	const sharePassword = await umbreld.client.files.sharePassword.query()

	// Add the local share as a network share
	const mountPath = await pRetry(
		() =>
			umbreld.client.files.addNetworkShare.mutate({
				host: 'localhost',
				share: `${shareName} (Umbrel)`,
				username: 'umbrel',
				password: sharePassword,
			}),
		{retries: 5, factor: 1},
	)

	return mountPath
}

describe('listNetworkShares()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.listNetworkShares.query()).rejects.toThrow('Invalid token')
	})

	test('returns empty array on first start', async () => {
		const shares = await umbreld.client.files.listNetworkShares.query()
		expect(shares).toStrictEqual([])
	})

	test('returns network shares with mount status', async () => {
		const mountPath = await createNetworkShare(umbreld, 'network-test-share')

		// List network shares
		const shares = await umbreld.client.files.listNetworkShares.query()
		expect(shares).toHaveLength(1)
		expect(shares[0]).toEqual({
			host: 'localhost',
			share: 'network-test-share (Umbrel)',
			mountPath,
			isMounted: true,
		})
	})
})

describe('addNetworkShare()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(
			umbreld.unauthenticatedClient.files.addNetworkShare.mutate({
				host: 'localhost',
				share: 'test',
				username: 'user',
				password: 'pass',
			}),
		).rejects.toThrow('Invalid token')
	})

	test('successfully adds and mounts a network share', async () => {
		const mountPath = await createNetworkShare(umbreld, 'samba-network-test')

		expect(mountPath).toBe('/Network/localhost/samba-network-test (Umbrel)')

		// Verify the share is mounted and accessible
		const networkFiles = await umbreld.client.files.list.query({path: mountPath})
		expect(networkFiles.files).toHaveLength(1)
		expect(networkFiles.files[0].name).toBe('test-file.txt')

		// Test writing a new directory in the network share
		await umbreld.client.files.createDirectory.mutate({path: `${mountPath}/new-directory`})
		const result = await umbreld.client.files.list.query({path: mountPath})
		expect(result.files.map((f) => f.name)).toContain('new-directory')
	})

	test('throws error when adding duplicate network share', async () => {
		await createNetworkShare(umbreld, 'duplicate-network-test')

		// Get share password
		const sharePassword = await umbreld.client.files.sharePassword.query()

		// Try to add the same share again
		await expect(
			umbreld.client.files.addNetworkShare.mutate({
				host: 'localhost',
				share: 'duplicate-network-test (Umbrel)',
				username: 'umbrel',
				password: sharePassword,
			}),
		).rejects.toThrow('already exists')
	})

	test('throws error with invalid credentials', async () => {
		// Create a test directory and add it as a local Samba share
		const testDirectory = `${umbreld.instance.dataDirectory}/home/invalid-creds-test`
		await fse.mkdir(testDirectory)

		// Add directory as a Samba share
		await umbreld.client.files.addShare.mutate({path: '/Home/invalid-creds-test'})

		// Wait for Samba to start
		await delay(3000)

		// Try to add network share with wrong password
		await expect(
			umbreld.client.files.addNetworkShare.mutate({
				host: 'localhost',
				share: 'invalid-creds-test (Umbrel)',
				username: 'umbrel',
				password: 'wrong-password',
			}),
		).rejects.toThrow()
	})

	test('cleans up mount directory when mount fails', async () => {
		// Try to mount a non-existent share
		await expect(
			umbreld.client.files.addNetworkShare.mutate({
				host: 'non-existent-host.local',
				share: 'non-existent-share',
				username: 'test',
				password: 'secret',
			}),
		).rejects.toThrow()

		// Verify no leftover directories were created
		const networkFiles = await umbreld.client.files.list.query({path: '/Network'})
		expect(networkFiles.files).toHaveLength(0)
	})
})

describe('removeNetworkShare()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(
			umbreld.unauthenticatedClient.files.removeNetworkShare.mutate({mountPath: '/Network/test/share'}),
		).rejects.toThrow('Invalid token')
	})

	test('throws error when removing non-existent share', async () => {
		await expect(
			umbreld.client.files.removeNetworkShare.mutate({
				mountPath: '/Network/non-existent/share',
			}),
		).rejects.toThrow('Share with mount path /Network/non-existent/share not found')
	})

	test('successfully removes a network share', async () => {
		const mountPath = await createNetworkShare(umbreld, 'remove-network-test')

		// Verify share exists
		const sharesBefore = await umbreld.client.files.listNetworkShares.query()
		expect(sharesBefore).toHaveLength(1)

		// Remove the network share
		const result = await umbreld.client.files.removeNetworkShare.mutate({mountPath})
		expect(result).toBe(true)

		// Verify share is removed
		const sharesAfter = await umbreld.client.files.listNetworkShares.query()
		expect(sharesAfter).toHaveLength(0)
	})
})

describe('discoverNetworkShareServers()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.discoverNetworkShareServers.query()).rejects.toThrow(
			'Invalid token',
		)
	})

	// Skipping for now since this will fail in CI
	// TODO: Fix this test by running a full blown umbrel-dev instance in CI
	test.skip('returns array of discovered servers', async () => {
		const servers = await umbreld.client.files.discoverNetworkShareServers.query()
		expect(servers).toContain('umbrel-dev.local')
	})
})

describe('discoverNetworkSharesOnServer()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(
			umbreld.unauthenticatedClient.files.discoverNetworkSharesOnServer.query({
				host: 'localhost',
				username: 'user',
				password: 'pass',
			}),
		).rejects.toThrow('Invalid token')
	})

	test('throws error with invalid credentials', async () => {
		// Create a test directory and add it as a Samba share
		const testDirectory = `${umbreld.instance.dataDirectory}/home/discover-invalid-test`
		await fse.mkdir(testDirectory)

		// Add directory as a Samba share
		await umbreld.client.files.addShare.mutate({path: '/Home/discover-invalid-test'})

		// Wait for Samba to start
		await delay(3000)

		// Try to discover shares with wrong credentials
		await expect(
			umbreld.client.files.discoverNetworkSharesOnServer.query({
				host: 'localhost',
				username: 'umbrel',
				password: 'wrong-password',
			}),
		).rejects.toThrow()
	})

	test('discovers shares on local Samba server', async () => {
		// Create test directories and add them as Samba shares
		const testDirectory1 = `${umbreld.instance.dataDirectory}/home/discover-test-1`
		const testDirectory2 = `${umbreld.instance.dataDirectory}/home/discover-test-2`
		await fse.mkdir(testDirectory1)
		await fse.mkdir(testDirectory2)

		// Add directories as Samba shares
		await umbreld.client.files.addShare.mutate({path: '/Home/discover-test-1'})
		await umbreld.client.files.addShare.mutate({path: '/Home/discover-test-2'})

		// Wait for Samba to start and be ready
		await delay(1000)

		// Get share password
		const sharePassword = await umbreld.client.files.sharePassword.query()

		// Discover shares on localhost
		const shares = await umbreld.client.files.discoverNetworkSharesOnServer.query({
			host: 'localhost',
			username: 'umbrel',
			password: sharePassword,
		})

		// Should find our test shares
		expect(shares).toMatchObject(expect.arrayContaining(['discover-test-1 (Umbrel)', 'discover-test-2 (Umbrel)']))
	})
})

describe('isServerAnUmbrelDevice()', () => {
	test('returns true for an umbrel device', async () => {
		const address = `localhost:${umbreld.instance.server.port}`
		const isServerAnUmbrelDevice = await umbreld.client.files.isServerAnUmbrelDevice.query({address})
		expect(isServerAnUmbrelDevice).toBe(true)
	})

	test('returns false for a non-umbrel device', async () => {
		const address = 'localhost:12345'
		const isServerAnUmbrelDevice = await umbreld.client.files.isServerAnUmbrelDevice.query({address})
		expect(isServerAnUmbrelDevice).toBe(false)
	})
})

describe('file permissions', () => {
	test('allows hard deletion of network files', async () => {
		const mountPath = await createNetworkShare(umbreld, 'network-deletion-test')

		// Attempt to hard delete a file from the network share
		await expect(umbreld.client.files.delete.mutate({path: `${mountPath}/test-file.txt`})).resolves.not.toThrow()
	})

	test('does not allow soft trash of network files', async () => {
		const mountPath = await createNetworkShare(umbreld, 'network-trash-test')

		// Attempt to trash a file from the network share
		await expect(umbreld.client.files.trash.mutate({path: `${mountPath}/test-file.txt`})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('network mount points are protected paths', async () => {
		const mountPath = await createNetworkShare(umbreld, 'network-protected-test')

		// Test each level of the mount path is protected
		expect(mountPath).toBe('/Network/localhost/network-protected-test (Umbrel)')
		const hostnamePath = '/Network/localhost'
		const networkPath = '/Network'
		for (const path of [networkPath, hostnamePath, mountPath]) {
			// Trash
			await expect(umbreld.client.files.trash.mutate({path})).rejects.toThrow('[operation-not-allowed]')
			// Delete
			await expect(umbreld.client.files.delete.mutate({path})).rejects.toThrow('[operation-not-allowed]')
			// Move
			await expect(umbreld.client.files.move.mutate({path, toDirectory: '/Home'})).rejects.toThrow(
				'[operation-not-allowed]',
			)
			// Rename
			await expect(umbreld.client.files.rename.mutate({path, newName: 'Renamed Network Share'})).rejects.toThrow(
				'[operation-not-allowed]',
			)
			// Can't have siblings created
			// Skip /Network cos /test is not a valid base path
			if (path !== networkPath) {
				const siblingPath = nodePath.join(nodePath.dirname(path), 'test')
				await expect(umbreld.client.files.createDirectory.mutate({path: siblingPath})).rejects.toThrow(
					'[operation-not-allowed]',
				)
			}
		}
	})

	test('network storage paths cannot be shared', async () => {
		const mountPath = await createNetworkShare(umbreld, 'network-sharing-test')

		// Test that network paths cannot be shared
		expect(mountPath).toBe('/Network/localhost/network-sharing-test (Umbrel)')
		const hostnamePath = '/Network/localhost'
		const networkPath = '/Network'
		const shareFilePath = `${mountPath}/test-file.txt`

		for (const path of [networkPath, hostnamePath, mountPath, shareFilePath]) {
			await expect(umbreld.client.files.addShare.mutate({path})).rejects.toThrow('[operation-not-allowed]')
		}
	})
})

describe('behaviour', () => {
	test('auto mounts an added network share on startup', async () => {
		const mountPath = await createNetworkShare(umbreld, 'startup-test')

		expect(mountPath).toBe('/Network/localhost/startup-test (Umbrel)')

		// Verify the share is mounted and accessible
		const networkFiles = await umbreld.client.files.list.query({path: mountPath})
		expect(networkFiles.files).toHaveLength(1)
		expect(networkFiles.files[0].name).toBe('test-file.txt')

		// Set the share watch interval to 100ms and restart umbreld
		umbreld.instance.files.networkStorage.shareWatchInterval = 100
		await umbreld.instance.stop()
		await umbreld.instance.start()

		// Verify the share is still mounted and accessible
		// Retry a few times because it might take a while for the share to be available
		await pRetry(
			async () => {
				const networkFilesAfterRestart = await umbreld.client.files.list.query({path: mountPath})
				expect(networkFilesAfterRestart.files).toHaveLength(1)
				expect(networkFilesAfterRestart.files[0].name).toBe('test-file.txt')
			},
			{retries: 10, factor: 1},
		)
	})

	test('auto mounts remounts a network share if it goes offline and then comes back online', async () => {
		// Set the share watch interval to 100ms and restart umbreld
		umbreld.instance.files.networkStorage.shareWatchInterval = 100
		await umbreld.instance.stop()
		await umbreld.instance.start()

		const mountPath = await createNetworkShare(umbreld, 'reconnect-test')

		expect(mountPath).toBe('/Network/localhost/reconnect-test (Umbrel)')

		// Verify the share is mounted and accessible
		const networkFiles = await umbreld.client.files.list.query({path: mountPath})
		expect(networkFiles.files).toHaveLength(1)
		expect(networkFiles.files[0].name).toBe('test-file.txt')

		// Remove the share
		await umbreld.client.files.removeShare.mutate({path: '/Home/reconnect-test'})

		// Verify the share is no longer mounted
		await expect(umbreld.client.files.list.query({path: mountPath})).rejects.toThrow('EHOSTDOWN')

		// Add the share again
		await umbreld.client.files.addShare.mutate({path: '/Home/reconnect-test'})

		// Verify the share got automatically remounted
		await pRetry(
			async () => {
				const networkFilesAfterRestart = await umbreld.client.files.list.query({path: mountPath})
				expect(networkFilesAfterRestart.files).toHaveLength(1)
				expect(networkFilesAfterRestart.files[0].name).toBe('test-file.txt')
			},
			{retries: 10, factor: 1},
		)
	})

	test('cleans up mounts on shutdown', async () => {
		const mountPath = await createNetworkShare(umbreld, 'cleanup-test')

		expect(mountPath).toBe('/Network/localhost/cleanup-test (Umbrel)')

		// Verify the share is mounted and accessible
		const networkFiles = await umbreld.client.files.list.query({path: mountPath})
		expect(networkFiles.files).toHaveLength(1)
		expect(networkFiles.files[0].name).toBe('test-file.txt')

		// Check mount point exists
		const systemMountPath = await umbreld.instance.files.virtualToSystemPath(mountPath)
		expect(fse.existsSync(systemMountPath)).toBe(true)

		// Stop umbreld
		await umbreld.instance.stop().catch((error) => console.log(error))

		// Check mount point is removed
		expect(fse.existsSync(systemMountPath)).toBe(false)

		// Start umbreld again (just to afterEach stop doesn't fail)
		await umbreld.instance.start()
	})
})
