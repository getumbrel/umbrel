import {expect, test, beforeEach, afterEach} from 'vitest'
import fse from 'fs-extra'
import {delay} from 'es-toolkit'
import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

// Create new umbreld instance for each test to clear recent state
beforeEach(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

// Clean up after each test
afterEach(async () => {
	await umbreld.cleanup()
})

test('recents() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.files.recents.query()).rejects.toThrow('Invalid token')
})

test('recents() returns recently modified files in correct order', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/recents-test`
	await fse.mkdir(testDirectory)

	// Create files with different timestamps
	await fse.writeFile(`${testDirectory}/file1.txt`, 'content1')
	await fse.writeFile(`${testDirectory}/file2.txt`, 'content2')
	await fse.writeFile(`${testDirectory}/file3.txt`, 'content3')

	// Allow time for events to fire
	await delay(100)

	// Get recent files
	const recentFiles = await umbreld.client.files.recents.query()

	// Verify the order (most recent first)
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['file3.txt', 'file2.txt', 'file1.txt'])
})

test('recents() updates when files are modified', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/recents-update-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/original.txt`, 'original content')

	// Allow time for events to fire
	await delay(100)

	// Get initial recent files
	let recentFiles = await umbreld.client.files.recents.query()
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['original.txt'])

	// Modify the file
	await fse.writeFile(`${testDirectory}/original.txt`, 'modified content')

	// Allow time for events to fire
	await delay(100)

	// Get updated recent files
	recentFiles = await umbreld.client.files.recents.query()
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['original.txt'])
})

test('recents() removes deleted files', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/recents-delete-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/to-delete.txt`, 'temporary content')
	await fse.writeFile(`${testDirectory}/keep.txt`, 'keeping this')

	// Wait for watcher to process the creation
	await delay(100)

	// Verify files are in recent list
	let recentFiles = await umbreld.client.files.recents.query()
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['to-delete.txt', 'keep.txt'])

	// Delete one file
	await fse.remove(`${testDirectory}/to-delete.txt`)

	// Wait for watcher to process the deletion
	await delay(100)

	// Verify deleted file is removed from recents
	recentFiles = await umbreld.client.files.recents.query()
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['keep.txt'])
})

test('recents() ignores hidden files', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/recents-hidden-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/.DS_Store`, 'hidden content')
	await fse.writeFile(`${testDirectory}/visible.txt`, 'visible content')

	// Allow time for events to fire
	await delay(100)

	// Get recent files
	const recentFiles = await umbreld.client.files.recents.query()

	// Verify only visible file is included
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['visible.txt'])
})

test('recents() ignores files after they are sent to trash', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/recents-trash-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/to-trash.txt`, 'trash content')
	await fse.writeFile(`${testDirectory}/keep.txt`, 'keep content')

	// Allow time for events to fire
	await delay(100)

	// Verify files are in recent list
	let recentFiles = await umbreld.client.files.recents.query()
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['to-trash.txt', 'keep.txt'])

	// Move file to trash using the RPC client
	const virtualPath = `/Home/recents-trash-test/to-trash.txt`
	await umbreld.client.files.trash.mutate({path: virtualPath})

	// Allow time for events to fire
	await delay(100)

	// Verify trashed file is removed from recents
	recentFiles = await umbreld.client.files.recents.query()
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['keep.txt'])
})

test('recents() persists after umbreld restart', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/recents-persist-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/persist.txt`, 'persist content')

	// Allow time for events to fire
	await delay(100)

	// Verify file is in recents
	let recentFiles = await umbreld.client.files.recents.query()
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['persist.txt'])

	// Check changes are not yet persisted
	let recentFileInStore = await umbreld.instance.store.get('files.recents')
	expect(recentFileInStore).toHaveLength(0)

	// Stop umbreld
	await umbreld.instance.stop()

	// Check changes were persisted
	recentFileInStore = await umbreld.instance.store.get('files.recents')
	expect(recentFileInStore).toHaveLength(1)
	expect(recentFileInStore[0].endsWith('persist.txt')).toBe(true)
})

test('recents() ignores app data files', async () => {
	// Create test files in both home and app data directories
	const homeDirectory = `${umbreld.instance.dataDirectory}/home/recents-app-test`
	const appDirectory = `${umbreld.instance.dataDirectory}/app-data/recents-app-test`
	await fse.mkdir(homeDirectory)
	await fse.mkdir(appDirectory)

	// Create files in both directories
	await fse.writeFile(`${homeDirectory}/home-file.txt`, 'home content')
	await fse.writeFile(`${appDirectory}/app-file.txt`, 'app content')

	// Allow time for events to fire
	await delay(100)

	// Get recent files
	const recentFiles = await umbreld.client.files.recents.query()

	// Verify only home file is included, app file is ignored
	expect(recentFiles.map((file) => file.name)).toStrictEqual(['home-file.txt'])
})

test('recents() respects maximum number of entries', async () => {
	// Create test directory
	const testDirectory = `${umbreld.instance.dataDirectory}/home/recents-max-test`
	await fse.mkdir(testDirectory)

	// Create one more file than the maximum limit
	const maxRecents = 50
	for (let i = 1; i <= maxRecents + 1; i++) {
		await fse.writeFile(`${testDirectory}/file${i}.txt`, '')
		// Allow time for events to fire
		await delay(100)
	}

	// Get recent files
	const recentFiles = await umbreld.client.files.recents.query()

	// Verify we only get the maximum number of entries
	expect(recentFiles.length).toBe(maxRecents)

	// Verify the most recent files are included (highest numbers)
	const fileNames = recentFiles.map((file) => file.name)
	// ['file 51.txt', 'file50.txt', ..., 'file2.txt']
	const expectedFileNames = Array.from({length: maxRecents}, (_, i) => `file${maxRecents + 1 - i}.txt`)
	expect(fileNames).toStrictEqual(expectedFileNames)
})
