import {expect, beforeEach, afterEach, describe, test} from 'vitest'

import fse from 'fs-extra'
import {delay} from 'es-toolkit'
import {default as SMB2} from '@tryjsky/v9u-smb2'
import tcpPortUsed from 'tcp-port-used'
import {$} from 'execa'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

// Create a new umbreld instance for each test
beforeEach(async () => (umbreld = await createTestUmbreld({autoLogin: true})))
afterEach(async () => await umbreld.cleanup())

describe('shares()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.shares.query()).rejects.toThrow('Invalid token')
	})

	test('returns empty array on first start', async () => {
		const shares = await umbreld.client.files.shares.query()
		expect(shares).toStrictEqual([])
	})

	test('only returns existing directories', async () => {
		// Create test directories
		const testDirectory1 = `${umbreld.instance.dataDirectory}/home/samba-existing-test1`
		const testDirectory2 = `${umbreld.instance.dataDirectory}/home/samba-existing-test2`
		await fse.mkdir(testDirectory1)
		await fse.mkdir(testDirectory2)

		// Add both directories to shares
		await umbreld.client.files.addShare.mutate({
			path: '/Home/samba-existing-test1',
		})
		await umbreld.client.files.addShare.mutate({
			path: '/Home/samba-existing-test2',
		})

		// Delete one directory
		await fse.remove(testDirectory1)

		// Verify only existing directory is returned in shares
		const shares = await umbreld.client.files.shares.query()
		const paths = shares.map((share) => share.path)
		expect(paths).not.toContain('/Home/samba-existing-test1')
		expect(paths).toContain('/Home/samba-existing-test2')
	})

	test('returns proper client-facing sharename for non /Home shares', async () => {
		// Create test directory
		const dir = `${umbreld.instance.dataDirectory}/home/samba-clientname-test`
		await fse.mkdir(dir)

		// Add to shares
		await umbreld.client.files.addShare.mutate({path: '/Home/samba-clientname-test'})

		// Verify sharename is returned
		const shares = await umbreld.client.files.shares.query()
		const entry = shares.find((s) => s.path === '/Home/samba-clientname-test') as any
		expect(entry?.sharename).toBe('samba-clientname-test (Umbrel)')
	})

	test('returns sharename for Home share', async () => {
		// Add home directory to shares
		await umbreld.client.files.addShare.mutate({path: '/Home'})

		// Verify sharename matches username's Umbrel
		const shares = await umbreld.client.files.shares.query()
		const entry = shares.find((s) => s.path === '/Home') as any
		expect(entry?.sharename).toBe("satoshi's Umbrel")
	})
})

describe('#handleFileChange()', () => {
	test('automatically removes shares when directory is deleted', async () => {
		// Create test directories
		const testDirectoryToDelete = `${umbreld.instance.dataDirectory}/home/samba-auto-remove-test`
		const testDirectoryToKeep = `${umbreld.instance.dataDirectory}/home/samba-keep-test`
		await fse.mkdir(testDirectoryToDelete)
		await fse.mkdir(testDirectoryToKeep)

		// Wait for the creation fs events to fire
		await delay(100)

		// Add both directories to shares
		await umbreld.client.files.addShare.mutate({path: '/Home/samba-auto-remove-test'})
		await umbreld.client.files.addShare.mutate({path: '/Home/samba-keep-test'})

		// Verify directories are in shares
		let shares = await umbreld.client.files.shares.query()
		const paths = shares.map((share) => share.path)
		expect(paths).toContain('/Home/samba-auto-remove-test')
		expect(paths).toContain('/Home/samba-keep-test')

		// Delete one directory
		await fse.remove(testDirectoryToDelete)

		// Wait for watcher to process the deletion
		await delay(100)

		// Verify deleted directory is removed from the store
		// but the kept directory remains
		// We check the store directly here because the RPC query auto
		// strips non-existent files from the result
		const storedShares = await umbreld.instance.store.get('files.shares')
		const storedPaths = storedShares.map((share) => share.path)
		expect(storedPaths).not.toContain('/Home/samba-auto-remove-test')
		expect(storedPaths).toContain('/Home/samba-keep-test')
	})

	test('automatically removes shares when directory is renamed', async () => {
		// Create test directory
		const originalDirectory = `${umbreld.instance.dataDirectory}/home/original-directory`
		const renamedDirectory = `${umbreld.instance.dataDirectory}/home/renamed-directory`
		await fse.mkdir(originalDirectory)

		// Wait for the creation fs events to fire
		await delay(100)

		// Add directory to shares
		await umbreld.client.files.addShare.mutate({path: '/Home/original-directory'})

		// Verify directory is in shares
		let shares = await umbreld.client.files.shares.query()
		const paths = shares.map((share) => share.path)
		expect(paths).toContain('/Home/original-directory')

		// Rename the directory (this causes a delete event for the original path)
		await fse.rename(originalDirectory, renamedDirectory)

		// Wait for watcher to process the events
		await delay(100)

		// Verify original path is removed from the store
		const storedShares = await umbreld.instance.store.get('files.shares')
		const storedPaths = storedShares ? storedShares.map((share) => share.path) : []
		expect(storedPaths).not.toContain('/Home/original-directory')
	})

	test('automatically removes child shares when parent directory is deleted', async () => {
		// Create test directories
		const parentDirectory = `${umbreld.instance.dataDirectory}/home/parent-directory`
		const childDirectory = `${parentDirectory}/child-directory`
		await fse.mkdir(parentDirectory)
		await fse.mkdir(childDirectory)

		// Wait for the creation fs events to fire
		await delay(100)

		// Add child directory to shares
		await umbreld.client.files.addShare.mutate({path: '/Home/parent-directory/child-directory'})

		// Verify directories are in shares
		let shares = await umbreld.client.files.shares.query()
		const paths = shares.map((share) => share.path)
		expect(paths).toContain('/Home/parent-directory/child-directory')

		// Delete parent directory (which also removes the child)
		await fse.remove(parentDirectory)

		// Wait for watcher to process the deletion
		await delay(100)

		// Verify deleted directory is removed from the store
		// We check the store directly here because the RPC query auto
		// strips non-existent files from the result
		const storedShares = await umbreld.instance.store.get('files.shares')
		const storedPaths = storedShares ? storedShares.map((share) => share.path) : []
		expect(storedPaths).not.toContain('/Home/parent-directory/child-directory')
	})
})

describe('addShare()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.addShare.mutate({path: '/Home/Documents'})).rejects.toThrow(
			'Invalid token',
		)
	})

	test('throws on non-directory paths', async () => {
		// Create test file
		const testDirectory = `${umbreld.instance.dataDirectory}/home/samba-test`
		await fse.mkdir(testDirectory)
		await fse.writeFile(`${testDirectory}/file.txt`, 'test content')

		// Attempt to share a file
		await expect(umbreld.client.files.addShare.mutate({path: '/Home/samba-test/file.txt'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('throws on unshareable app paths', async () => {
		// Create test directory
		const testDirectory = `${umbreld.instance.dataDirectory}/app-data/bitcoin`
		await fse.mkdir(testDirectory)

		// Attempt to share the directory
		await expect(umbreld.client.files.addShare.mutate({path: '/Apps/bitcoin'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('throws on unshareable external paths', async () => {
		// Create test directory
		const testDirectory = `${umbreld.instance.dataDirectory}/external/My Portable SSD`
		await fse.ensureDir(testDirectory)

		// Create subdirectory
		const subDirectory = `${testDirectory}/sub-directory`
		await fse.ensureDir(subDirectory)

		// Attempt to share the directory
		await expect(umbreld.client.files.addShare.mutate({path: '/External/My Portable SSD'})).rejects.toThrow(
			'[operation-not-allowed]',
		)

		// Attempt to share sub directory
		await expect(
			umbreld.client.files.addShare.mutate({path: '/External/My Portable SSD/sub-directory'}),
		).rejects.toThrow('[operation-not-allowed]')
	})

	test('throws on directory traversal attempt', async () => {
		await expect(umbreld.client.files.addShare.mutate({path: '/Home/../../../../etc/share-dir'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('throws on symlink traversal attempt', async () => {
		// Create a symlink to the root directory
		await fse.ensureDir(`${umbreld.instance.dataDirectory}/home`)
		await fse.symlink('/', `${umbreld.instance.dataDirectory}/home/symlink-to-root`)

		// Attempt to share directory through symlink
		await expect(umbreld.client.files.addShare.mutate({path: '/Home/symlink-to-root/etc'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('throws on relative paths', async () => {
		await Promise.all(
			['', ' ', '.', '..', 'Home', 'Home/shared-dir', 'Home/../shared-dir'].map((path) =>
				expect(umbreld.client.files.addShare.mutate({path})).rejects.toThrow('[operation-not-allowed]'),
			),
		)
	})

	test('throws on invalid base directory', async () => {
		await expect(umbreld.client.files.addShare.mutate({path: '/Invalid/test-share'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('successfully adds a directory to shares', async () => {
		// Create test directory
		const testDirectory = `${umbreld.instance.dataDirectory}/home/samba-test`
		await fse.mkdir(testDirectory)

		// Add directory to shares
		const result = await umbreld.client.files.addShare.mutate({path: '/Home/samba-test'})

		expect(result).toBe('/Home/samba-test')

		// Verify directory is in shares
		const shares = await umbreld.client.files.shares.query()
		const paths = shares.map((share) => share.path)
		expect(paths).toContain('/Home/samba-test')
	})

	test('successfully adds home directory to shares', async () => {
		// Add home directory to shares
		const result = await umbreld.client.files.addShare.mutate({path: '/Home'})
		expect(result).toBe('/Home')

		// Verify directory is in shares
		const shares = await umbreld.client.files.shares.query()
		const paths = shares.map((share) => share.path)
		expect(paths).toContain('/Home')
	})

	test('throws error on duplicate shares', async () => {
		// Create test directory
		const testDirectory = `${umbreld.instance.dataDirectory}/home/samba-duplicate-test`
		await fse.mkdir(testDirectory)

		// Add directory to shares
		await umbreld.client.files.addShare.mutate({
			path: '/Home/samba-duplicate-test',
		})

		// Try to add again and expect failure
		await expect(umbreld.client.files.addShare.mutate({path: '/Home/samba-duplicate-test'})).rejects.toThrow(
			'[share-already-exists]',
		)
	})

	test('auto-generates unique share names when basename conflicts', async () => {
		// Create test directories with same basename but different paths
		const testDirectory1 = `${umbreld.instance.dataDirectory}/home/folder1/same-name`
		const testDirectory2 = `${umbreld.instance.dataDirectory}/home/folder2/same-name`
		await fse.mkdir(testDirectory1, {recursive: true})
		await fse.mkdir(testDirectory2, {recursive: true})

		// Add both directories to shares
		await umbreld.client.files.addShare.mutate({path: '/Home/folder1/same-name'})
		await umbreld.client.files.addShare.mutate({path: '/Home/folder2/same-name'})

		// Verify both directories are added with unique names
		const shares = await umbreld.client.files.shares.query()
		const names = shares.map((share) => share.name)

		// Verify we have two distinct share names
		expect(names).toMatchObject(['same-name', 'same-name (2)'])
	})
})

describe('removeShare()', () => {
	test('successfully removes a directory from shares', async () => {
		// Create test directory
		const testDirectory = `${umbreld.instance.dataDirectory}/home/samba-remove-test`
		await fse.mkdir(testDirectory)

		// Add directory to shares
		await umbreld.client.files.addShare.mutate({path: '/Home/samba-remove-test'})

		// Remove from shares
		const result = await umbreld.client.files.removeShare.mutate({path: '/Home/samba-remove-test'})

		expect(result).toBe(true)

		// Verify directory is not in shares
		const shares = await umbreld.client.files.shares.query()
		const paths = shares.map((share) => share.path)
		expect(paths).not.toContain('/Home/samba-remove-test')
	})

	test('returns false when removing non-existent share', async () => {
		const result = await umbreld.client.files.removeShare.mutate({path: '/Home/non-existent-share'})

		expect(result).toBe(false)
	})
})

describe('sharePassword()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.sharePassword.query()).rejects.toThrow('Invalid token')
	})

	test('generates a 128-bit hex string on first run', async () => {
		const sharePassword = await umbreld.client.files.sharePassword.query()

		// Check it's a 128-bit hex string (32 hex characters = 128 bits)
		expect(sharePassword.length).toBe(32)
		expect(/^[0-9a-f]{32}$/.test(sharePassword)).toBe(true)
	})

	test('always returns the same password', async () => {
		const sharePassword1 = await umbreld.client.files.sharePassword.query()
		const sharePassword2 = await umbreld.client.files.sharePassword.query()

		// Verify it's consistently the same password
		expect(sharePassword1).toBe(sharePassword2)
	})
})

describe('samba', () => {
	async function createSmbClient(share: string) {
		const password = await umbreld.client.files.sharePassword.query()
		return new (SMB2 as any)({
			share: `\\\\localhost\\${share}`,
			username: 'umbrel',
			password,
		})
	}

	test('port is only listening where shares are active', async () => {
		const smbPort = 445

		// Check if port is open
		await expect(tcpPortUsed.check(smbPort, 'localhost')).resolves.toBe(false)

		// Add home directory to shares
		await expect(umbreld.client.files.addShare.mutate({path: '/Home'})).resolves.toBe('/Home')

		// Check if port is open
		await expect(tcpPortUsed.check(smbPort, 'localhost')).resolves.toBe(true)

		// Remove share
		await expect(umbreld.client.files.removeShare.mutate({path: '/Home'})).resolves.toBe(true)

		// Check if port is closed again
		await expect(tcpPortUsed.check(smbPort, 'localhost')).resolves.toBe(false)
	})

	test('share name has (Umbrel appended)', async () => {
		// Add home directory to shares
		await expect(umbreld.client.files.addShare.mutate({path: '/Home/Documents'})).resolves.toBe('/Home/Documents')

		// create an SMB2 instance
		const smb = await createSmbClient('Documents (Umbrel)')

		// Test connection
		await expect(smb.exists('non-existent-file.txt')).resolves.toBe(false)
	})

	test('/Home share is called "username\'s Umbrel"', async () => {
		// Add home directory to shares
		await expect(umbreld.client.files.addShare.mutate({path: '/Home'})).resolves.toBe('/Home')

		// create an SMB2 instance
		const smb = await createSmbClient("satoshi's Umbrel")

		// Test connection
		await expect(smb.exists('non-existent-file.txt')).resolves.toBe(false)
	})

	// This test can be a little flaky (seemingly due to pure js samba client) so retry on failure
	test('client can interact with share', {retry: 5}, async () => {
		// Add home directory to shares
		await expect(umbreld.client.files.addShare.mutate({path: '/Home'})).resolves.toBe('/Home')

		// create an SMB2 instance
		const smb = await createSmbClient("satoshi's Umbrel")

		// Test connection
		await expect(smb.exists('non-existent-file.txt')).resolves.toBe(false)

		// Test write
		await expect(smb.writeFile('file.txt', 'hello world', {encoding: 'utf8'})).resolves.toBe(undefined)

		// Test file exists on filesystem
		await expect(fse.exists(`${umbreld.instance.dataDirectory}/home/file.txt`)).resolves.toBe(true)

		// Test read
		await expect(smb.readFile('file.txt', {encoding: 'utf8'})).resolves.toBe('hello world')

		// Remove the share
		await expect(umbreld.client.files.removeShare.mutate({path: '/Home'})).resolves.toBe(true)

		// Test read no longer works
		// For some reason the first read after close hangs and the second throws so we do a dummy read
		// first that hangs
		smb.readFile('file.txt', {encoding: 'utf8'})
		// And then a second read that throws
		await expect(smb.readFile('file.txt', {encoding: 'utf8'})).rejects.toThrow('write EPIPE')
	})

	test('reloads config when shares are updated', async () => {
		const smbHome = await createSmbClient("satoshi's Umbrel")
		let smbDocuments = await createSmbClient('Documents (Umbrel)')

		// Add home directory to shares and test it works
		await umbreld.client.files.addShare.mutate({path: '/Home'})
		await expect(smbHome.exists('non-existent-file.txt')).resolves.toBe(false)
		await expect(smbDocuments.exists('non-existent-file.txt')).rejects.toThrow('STATUS_BAD_NETWORK_NAME')

		// Add documents share and test it works
		// We need to recreate the client because for some reason it can't be used after the above error
		smbDocuments = await createSmbClient('Documents (Umbrel)')
		await umbreld.client.files.addShare.mutate({path: '/Home/Documents'})
		await expect(smbHome.exists('non-existent-file.txt')).resolves.toBe(false)
		await expect(smbDocuments.exists('non-existent-file.txt')).resolves.toBe(false)
	})

	test("doesn't allow escaping shared directories via path traversal", async () => {
		// Create test directory file
		const testFile = `${umbreld.instance.dataDirectory}/home/path-traversal-test/test/file.txt`
		await fse.ensureFile(testFile)

		// Create a sensitive file outside the share
		const sensitiveFile = `${umbreld.instance.dataDirectory}/secrets/sensitive.txt`
		await fse.ensureFile(sensitiveFile)

		// Add test directory to shares
		await umbreld.client.files.addShare.mutate({path: '/Home/path-traversal-test'})

		// Connect to share
		const smb = await createSmbClient('path-traversal-test (Umbrel)')

		// Test ..\\ syntax works
		await expect(smb.readFile('test\\..\\test\\file.txt', {encoding: 'utf8'})).resolves.toBe('')

		// Test traversal outside of share fails
		await expect(smb.readFile('..\\..\\secrets\\sensitive.txt', {encoding: 'utf8'})).rejects.toThrow(
			'STATUS_OBJECT_PATH_SYNTAX_BAD',
		)
	})

	test("doesn't allow escaping shared directories via symlinks", async () => {
		// Create a sensitive file outside of files root
		const sensitiveFile = `${umbreld.instance.dataDirectory}/secrets/sensitive.txt`
		await fse.ensureFile(sensitiveFile)
		await fse.writeFile(sensitiveFile, 'sensitive data')

		// Create test directory with symlink to sensitive file and a normal file
		const testDirectory = `${umbreld.instance.dataDirectory}/home/symlink-traversal-test`
		await fse.ensureDir(testDirectory)
		await fse.symlink(sensitiveFile, `${testDirectory}/symlink-to-sensitive`)
		await fse.ensureFile(`${testDirectory}/normal-file`)

		// Add test directory to shares
		await umbreld.client.files.addShare.mutate({path: '/Home/symlink-traversal-test'})

		// Connect to share
		const smb = await createSmbClient('symlink-traversal-test (Umbrel)')

		// Test samba lists the normal file but not the symlink
		await expect(smb.readFile('normal-file', {encoding: 'utf8'})).resolves.toBe('')
		await expect(smb.readFile('symlink-to-sensitive', {encoding: 'utf8'})).rejects.toThrow(
			'STATUS_OBJECT_NAME_NOT_FOUND',
		)
	})
})

describe('wsdd2', () => {
	test('runs only while samba runs', async () => {
		// Check wsdd2 is not running
		await expect($`systemctl is-active wsdd2`).rejects.toThrow('inactive')

		// Add home directory to shares
		await expect(umbreld.client.files.addShare.mutate({path: '/Home'})).resolves.toBe('/Home')

		// Check wsdd2 is running
		await expect($`systemctl is-active wsdd2`).resolves.toMatchObject({stdout: 'active'})

		// Remove share
		await expect(umbreld.client.files.removeShare.mutate({path: '/Home'})).resolves.toBe(true)

		// Check wsdd2 is not running
		await expect($`systemctl is-active wsdd2`).rejects.toThrow('inactive')
	})
})
