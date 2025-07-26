/*
Tests in this file that involve the background watcher (e.g., those relying on file changes to trigger thumbnail generation) can be flaky in GitHub Actions CI due to variable watcher event delays and generation times (via convert/FFmpeg), stemming from VM resource limits and disk I/O.

We do the following to give a high probability of success in CI:
- waitForThumbnailDebounce(): Explicitely waits 1500ms after ops to cover 1000ms debounce + event propagation/CI variability.
- pollUntil timeouts: continues polling for existence of a thumbnail for 15000ms (15s) for thumbnail generation breathing room in CI.
- { retry: 5 }: Auto-retries to handle timing outliers (e.g., very slow thumbnail generation or missed events).
*/

import nodePath from 'node:path'

import {expect, test, describe, beforeEach, afterEach, vi} from 'vitest'
import fse from 'fs-extra'
import {delay} from 'es-toolkit'
import {$} from 'execa'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

// Create new umbreld instance for each test
beforeEach(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

// Clean up after each test
afterEach(async () => {
	await umbreld.cleanup()
})

// Helper to copy fixture files for testing
async function copyFixtureFile(
	destinationDir: string,
	fixtureName: string = 'master-lossless-image.png',
	customName?: string,
) {
	// Ensure target directory exists
	await fse.ensureDir(destinationDir)

	// Fixture files are in the same parent directory as this test file at /fixures/thumbnails
	const fixturePath = nodePath.resolve(__dirname, 'fixtures', 'thumbnails', fixtureName)

	// Construct destination path by joining directory and fixture name
	const destinationPath = nodePath.join(destinationDir, customName || fixtureName)

	// Copy the fixture file to the test location
	await fse.copy(fixturePath, destinationPath)

	// return the destination path
	return destinationPath
}

// Helper function to poll until a condition is met or timeout occurs
async function pollUntil(
	condition: () => Promise<boolean>,
	{
		timeoutMs = 5000,
		intervalMs = 100,
		errorMessage = 'Polling timed out',
		label,
	}: {
		timeoutMs?: number
		intervalMs?: number
		errorMessage?: string
		label?: string
	} = {},
): Promise<void> {
	const startTime = Date.now()

	while (Date.now() - startTime < timeoutMs) {
		if (await condition()) return
		await delay(intervalMs)
	}

	throw new Error(errorMessage)
}

// Helper to wait for the thumbnail generation debounce period after file operations (1000ms in thumbnails.ts).
// The production debounce resets on each event for the path (e.g., multiple update's during copy), waiting 1000ms after the last one before generating.
// We use a slightly longer period (1500ms) to account for FS event propagation, potential reset-triggering events, and CI variability before polling starts.
const waitForThumbnailDebounce = () => delay(1500)

describe('getThumbnail', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.getThumbnail.mutate({path: '/Home/test.jpg'})).rejects.toThrow(
			'Invalid token',
		)
	})

	test.todo('cannot generate thumbnail outside of /Home /Apps /Trash /External')

	test('returns a correctly formatted api endpoint URL for a thumbnail', async () => {
		// Create test image
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		await copyFixtureFile(testDir, 'master-lossless-image.png')

		// Get api endpoint URL for thumbnail
		const virtualPath = '/Home/thumbnail-test/master-lossless-image.png'
		const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Verify URL matches expected format (api endpoint of /api/files/thumbnail/:hash.webp where :hash is a valid hash)
		expect(thumbnailUrl).toBeTruthy()
		expect(thumbnailUrl).toMatch(/^\/api\/files\/thumbnail\/[a-f0-9]+\.webp$/i)
	})

	// This test specifically checks that getThumbnail triggers thumbnail generation when one does not exist
	// Other getThumbnail tests below this one can only guarantee that the thumbnail hash is returned, but it may have been generated via the background watcher or on-demand
	test('generates thumbnails on-demand when no thumbnail exists', {retry: 5}, async () => {
		// Create test image
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		await copyFixtureFile(testDir, 'master-lossless-image.png')

		await waitForThumbnailDebounce()

		// Wait for background watcher to generate the thumbnail so we are sure it won't interfere with the test
		// This is successful if one file exists in the thumbnails directory
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Background watcher did not generate thumbnail',
			},
		)

		// Delete the thumbnail
		const thumbnail = await fse.readdir(thumbnailDir)
		await fse.remove(nodePath.join(thumbnailDir, thumbnail[0]))

		// Verify thumbnail was deleted by checking that no files exist in the thumbnails directory
		const thumbnailsAfterDelete = await fse.readdir(thumbnailDir)
		expect(thumbnailsAfterDelete.length).toBe(0)

		// Call getThumbnail - it should generate the thumbnail on-demand
		const virtualPath = '/Home/thumbnail-test/master-lossless-image.png'
		const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Verify thumbnail was generated
		const thumbnailFilename = thumbnailUrl.split('/').pop()
		const thumbnailPath = `${thumbnailDir}/${thumbnailFilename}`
		const thumbnailExists = await fse.pathExists(thumbnailPath)
		expect(thumbnailExists).toBe(true)
	})

	const imageTypes = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']

	for (const imageType of imageTypes) {
		test(`returns a thumbnail for a ${imageType} file`, async () => {
			// Create test directory
			const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
			await fse.ensureDir(testDir)

			// Destination path for the test
			const imagePath = `${testDir}/test-image.${imageType}`

			// Use ImageMagick to convert PNG fixture directly to the test image type
			await $`convert ${nodePath.resolve(__dirname, 'fixtures', 'thumbnails', 'master-lossless-image.png')} ${imagePath}`

			// Get 	 api endpoint URL
			const virtualPath = `/Home/thumbnail-test/test-image.${imageType}`
			const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

			// Verify thumbnail file was created
			const thumbnailFilename = thumbnailUrl.split('/').pop()
			const thumbnailPath = `${umbreld.instance.dataDirectory}/thumbnails/${thumbnailFilename}`
			const thumbnailExists = await fse.pathExists(thumbnailPath)
			expect(thumbnailExists).toBe(true)
		})
	}

	test.todo('returns a thumbnail for a heic file once we support it')

	const videoTypes = ['.mkv', '.mov', '.mp4', '.3gp', '.avi']

	for (const videoType of videoTypes) {
		test(`returns a thumbnail for a ${videoType} file`, async () => {
			// Create test directory
			const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
			await fse.ensureDir(testDir)

			// Destination path for the test
			const videoPath = `${testDir}/test-video.${videoType}`

			// Use ffmpeg to convert mkv fixture directly to the test video type
			await $`ffmpeg -i ${nodePath.resolve(__dirname, 'fixtures', 'thumbnails', 'master-lossless-video.mkv')} -c:v libx264 ${videoPath}`

			// Get api endpoint URL for thumbnail
			const virtualPath = `/Home/thumbnail-test/test-video.${videoType}`
			const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

			// Verify thumbnail file was created
			const thumbnailFilename = thumbnailUrl.split('/').pop()
			const thumbnailPath = `${umbreld.instance.dataDirectory}/thumbnails/${thumbnailFilename}`
			const thumbnailExists = await fse.pathExists(thumbnailPath)
			expect(thumbnailExists).toBe(true)
		})
	}

	test.todo('returns a thumbnail for a pdf file')

	test('returns same thumbnail for renamed files', async () => {
		// Create test directory and image
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		const originalPath = await copyFixtureFile(testDir)

		// Get original thumbnail's api endpoint URL
		const virtualPath = '/Home/thumbnail-test/master-lossless-image.png'
		const originalThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Rename the file
		const renamedPath = nodePath.join(testDir, `renamed${nodePath.extname(originalPath)}`)
		await fse.rename(originalPath, renamedPath)

		// Get thumbnail's api endpoint URL for renamed file
		const renamedVirtualPath = '/Home/thumbnail-test/renamed.png'
		const renamedThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: renamedVirtualPath})

		// The thumbnail's api endpoint URL should be the same since filesystem UUID, inode, and date modified are the same
		expect(renamedThumbnailUrl).toBe(originalThumbnailUrl)
	})

	test('returns same thumbnail for moved files', async () => {
		// Create test directories
		const sourceDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test/source`
		const destDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test/destination`
		await fse.ensureDir(sourceDir)
		await fse.ensureDir(destDir)

		// Create test image in source directory
		const sourcePath = await copyFixtureFile(sourceDir)

		// Get original thumbnail api endpoint URL
		const virtualPath = '/Home/thumbnail-test/source/master-lossless-image.png'
		const originalThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Move the file to a different directory with same name
		const destinationPath = nodePath.join(destDir, nodePath.basename(sourcePath))
		await fse.move(sourcePath, destinationPath)

		// Get thumbnail's api endpoint URL for moved file
		const movedVirtualPath = '/Home/thumbnail-test/destination/master-lossless-image.png'
		const movedThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: movedVirtualPath})

		// The thumbnail's api endpoint URL should be the same since filesystem UUID, inode, and date modified are the same
		expect(movedThumbnailUrl).toBe(originalThumbnailUrl)
	})

	test('generates a new thumbnail when source file is modified', async () => {
		// Create test directory and image
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		const imagePath = await copyFixtureFile(testDir)

		// Get original thumbnail api endpoint URL
		const virtualPath = '/Home/thumbnail-test/master-lossless-image.png'
		const originalThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Get path to the original thumbnail file
		const originalThumbnailFilename = originalThumbnailUrl.split('/').pop()
		const originalThumbnailPath = `${umbreld.instance.dataDirectory}/thumbnails/${originalThumbnailFilename}`

		// Verify original thumbnail was created
		const originalThumbnailExists = await fse.pathExists(originalThumbnailPath)
		expect(originalThumbnailExists).toBe(true)

		// Wait a moment to ensure we get a different timestamp
		await delay(100)

		// Modify the file timestamp without changing content
		const newTime = new Date()
		await fse.utimes(imagePath, newTime, newTime)

		// Get thumbnail's api endpoint URL for modified file - should be a different hash because modification time has changed
		const modifiedVirtualPath = '/Home/thumbnail-test/master-lossless-image.png'
		const modifiedThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: modifiedVirtualPath})
		expect(modifiedThumbnailUrl).not.toBe(originalThumbnailUrl)

		// Get path to the new thumbnail file
		const newThumbnailFilename = modifiedThumbnailUrl.split('/').pop()
		const newThumbnailPath = `${umbreld.instance.dataDirectory}/thumbnails/${newThumbnailFilename}`

		// Verify new thumbnail was created
		const newThumbnailExists = await fse.pathExists(newThumbnailPath)
		expect(newThumbnailExists).toBe(true)
	})

	test('returns existing thumbnails when they exist without generating a new one', async () => {
		// Create test image
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		await copyFixtureFile(testDir)

		// Get thumbnail api endpoint URL first time
		const virtualPath = '/Home/thumbnail-test/master-lossless-image.png'
		const thumbnailUrl1 = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Get the thumbnail file stats
		const thumbnailFilename = thumbnailUrl1.split('/').pop()
		const thumbnailPath = `${umbreld.instance.dataDirectory}/thumbnails/${thumbnailFilename}`
		const stats = await fse.stat(thumbnailPath)
		const mtime = stats.mtime.getTime()

		// Wait a moment
		await delay(100)

		// Request thumbnail again
		const thumbnailUrl2 = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// The thumbnail's api endpoint URL should be the same
		expect(thumbnailUrl2).toBe(thumbnailUrl1)

		// Verify the thumbnail file stats are the same
		const stats2 = await fse.stat(thumbnailPath)
		expect(stats2.mtime.getTime()).toBe(mtime)
	})
})

describe('Background file watcher', () => {
	test('generates thumbnails for new image files', {retry: 5}, async () => {
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-watcher-test`
		await fse.ensureDir(testDir)

		// Copy the image file to the test directory
		await copyFixtureFile(testDir)

		await waitForThumbnailDebounce()

		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate thumbnail for new image',
			},
		)

		// Since this is a clean test environment, there should be exactly one thumbnail
		const thumbnails = await fse.readdir(thumbnailDir)
		expect(thumbnails.length).toBe(1)
	})

	test('does not update thumbnails when files are moved', {retry: 5}, async () => {
		// Create test directories
		const sourceDir = `${umbreld.instance.dataDirectory}/home/thumbnail-watcher-move-test/source`
		const destDir = `${umbreld.instance.dataDirectory}/home/thumbnail-watcher-move-test/destination`
		await fse.ensureDir(destDir)

		// Copy the image file to the source directory
		const sourcePath = await copyFixtureFile(sourceDir)

		await waitForThumbnailDebounce()

		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate initial thumbnail',
			},
		)

		// Get the thumbnail file stats
		const thumbnails = await fse.readdir(thumbnailDir)
		const thumbnailPath = `${thumbnailDir}/${thumbnails[0]}`
		const initialStats = await fse.stat(thumbnailPath)
		const initialMtime = initialStats.mtime.getTime()

		// Wait a moment to ensure move operation occurs some time after source file creation (won't impact source file's date modified for a move operation)
		// Allows us to verify that the thumbnail was not re-generated by ensuring the thumbnail's modified time remains the same
		await delay(100)

		// Move the file to a different directory with same name
		const destinationPath = nodePath.join(destDir, nodePath.basename(sourcePath))
		await fse.move(sourcePath, destinationPath)

		// Wait a conservative period to confirm the thumbnail was not re-generated
		// Note: Fixed delay is a bit hacky for negative assertion; uses 10000ms to cover debounce (1000ms) + potential generation time + CI buffer.
		await delay(10000)

		// Read the updated thumbnails directory - should still be just one thumbnail
		// since moving doesn't change the source file's inode, filesystem UUID, or date modified
		const finalThumbnails = await fse.readdir(thumbnailDir)
		expect(finalThumbnails.length).toBe(1)

		// Verify that the thumnbnails modified time remains the same to ensure it was not re-generated
		const finalStats = await fse.stat(thumbnailPath)
		expect(finalStats.mtime.getTime()).toBe(initialMtime)
	})

	test('does not update thumbnails when files are renamed', {retry: 5}, async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-watcher-rename-test`
		await fse.ensureDir(testDir)

		// Copy the image file to the test directory
		const originalPath = await copyFixtureFile(testDir)

		await waitForThumbnailDebounce()

		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate initial thumbnail',
			},
		)

		// Get the thumbnail file stats
		const thumbnails = await fse.readdir(thumbnailDir)
		const thumbnailPath = `${thumbnailDir}/${thumbnails[0]}`
		const initialStats = await fse.stat(thumbnailPath)
		const initialMtime = initialStats.mtime.getTime()

		// Wait a moment to ensure rename operation occurs some time after source file creation (won't impact source file's date modified for a rename operation)
		// Allows us to verify that the thumbnail was not re-generated by ensuring the thumbnail's modified time remains the same
		await delay(100)

		// Rename the file in the same directory
		const renamedPath = nodePath.join(testDir, `renamed${nodePath.extname(originalPath)}`)
		await fse.rename(originalPath, renamedPath)

		// Wait a conservative period to confirm the thumbnail was not re-generated
		// Note: Fixed delay is a bit hacky for negative assertion; uses 10000ms to cover debounce (1000ms) + potential generation time + CI buffer.
		await delay(10000)

		// Read the updated thumbnails directory - should still be just one thumbnail
		// since renaming doesn't change the inode, filesystem UUID, or date modified
		const finalThumbnails = await fse.readdir(thumbnailDir)
		expect(finalThumbnails.length).toBe(1)

		// Verify that the thumnbnails modified time remains the same
		const finalStats = await fse.stat(thumbnailPath)
		expect(finalStats.mtime.getTime()).toBe(initialMtime)
	})

	test('updates thumbnails when files are modified', {retry: 5}, async () => {
		// Create test directory and image
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-watcher-modify-test`
		const imagePath = await copyFixtureFile(testDir)

		await waitForThumbnailDebounce()

		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate initial thumbnail',
			},
		)

		// Get initial thumbnail info and file stats
		const initialThumbnails = await fse.readdir(thumbnailDir)
		expect(initialThumbnails.length).toBe(1)
		const initialThumbnailHash = initialThumbnails[0].split('.')[0]

		// Wait a moment to ensure file timestamps will be different
		await delay(100)

		// Modify the file timestamp without changing content
		const newTime = new Date()
		await fse.utimes(imagePath, newTime, newTime)

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the modification and generate a new thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				// Should have second thumbnail
				return thumbnails.length === 2
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate new thumbnail after file modification',
			},
		)

		// Get final thumbnails
		const finalThumbnails = await fse.readdir(thumbnailDir)

		// There should be two thumbnails
		expect(finalThumbnails.length).toBe(2)

		// Verify that the new thumbnail is different from the initial one
		const newThumbnailExists = finalThumbnails.some((t) => !t.startsWith(initialThumbnailHash))
		expect(newThumbnailExists).toBe(true)
	})

	test('ignores directories', {retry: 5}, async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		await fse.ensureDir(testDir)

		// Wait a conservative period to confirm the thumbnail was not generated
		// Note: Fixed delay is a bit hacky for negative assertion; uses 10000ms to cover debounce (1000ms) + potential generation time + CI buffer.
		await delay(10000)

		// Get the thumbnails directory
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`
		const thumbnails = await fse.readdir(thumbnailDir)

		// There should be no thumbnails
		expect(thumbnails.length).toBe(0)
	})

	test('ignores unsupported file types for thumbnails', {retry: 5}, async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		await fse.ensureDir(testDir)

		// create txt file
		await fse.writeFile(`${testDir}/test.txt`, 'test')

		await waitForThumbnailDebounce()

		// Wait a conservative period to confirm that the thumbnail was not generated
		// Note: Fixed delay is a bit hacky for negative assertion; uses 10000ms to cover debounce (1000ms) + potential generation time + CI buffer.
		await delay(10000)

		// Get the thumbnails directory
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`
		const thumbnails = await fse.readdir(thumbnailDir)

		// There should be no thumbnails
		expect(thumbnails.length).toBe(0)
	})
})

describe('files.list() [thumbnail specific]', () => {
	test('includes thumbnail for a file with an existing thumbnail', async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		await fse.ensureDir(testDir)

		// Copy the image file to the test directory
		await copyFixtureFile(testDir)

		await waitForThumbnailDebounce()

		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate initial thumbnail',
			},
		)

		// List the files in the test directory - files.list()
		const files = await umbreld.client.files.list.query({path: '/Home/thumbnail-test'})

		// Verify the thumbnail property is included for the listed file
		expect(files.files[0].thumbnail).toBeDefined()

		// Verify the thumbnail included in the listed file is the same as the one generated above
		const thumbnailsFromDir = await fse.readdir(thumbnailDir)
		const thumbnail = thumbnailsFromDir[0]

		// Add api endpoint details for proper comparison
		// We expect the thumbnail in the listed file to be of the format `/api/files/thumbnail/{hash}.webp`
		const thumbnailWithApiEndpoint = `/api/files/thumbnail/${thumbnail}`

		expect(files.files[0].thumbnail).toBe(thumbnailWithApiEndpoint)
	})

	test('does not include thumbnail for files without an existing thumbnail', async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		await fse.ensureDir(testDir)

		// Copy the image file to the test directory
		await copyFixtureFile(testDir)

		await waitForThumbnailDebounce()

		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate initial thumbnail',
			},
		)

		// Delete the thumbnail which will be the only file in the thumbnails directory
		const thumbnails = await fse.readdir(thumbnailDir)
		await fse.remove(`${thumbnailDir}/${thumbnails[0]}`)

		// Verify the thumbnail directory is empty
		const finalThumbnails = await fse.readdir(thumbnailDir)
		expect(finalThumbnails.length).toBe(0)

		// List the files in the test directory - files.list()
		const files = await umbreld.client.files.list.query({path: '/Home/thumbnail-test'})

		// Verify that no thumbnail is included for the file
		expect(files.files[0].thumbnail).toBeUndefined()
	})

	test('does not include thumbnail for directories', async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-test`
		await fse.ensureDir(testDir)

		// Create a subdirectory
		await fse.ensureDir(`${testDir}/subdir`)

		// List the files in the test directory - files.list()
		const files = await umbreld.client.files.list.query({path: '/Home/thumbnail-test'})

		// Verify that no thumbnail is included for the directory
		expect(files.files[0].thumbnail).toBeUndefined()
	})
})

describe('recents() [thumbnail specific]', () => {
	test('includes thumbnail for a recent file with an existing thumbnail', {retry: 5}, async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/recents-thumbnail-test`
		await fse.ensureDir(testDir)

		// Copy an image file to the test directory (use the helper)
		await copyFixtureFile(testDir, 'master-lossless-image.png', 'recent-image.png')

		await waitForThumbnailDebounce()

		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate initial thumbnail for recent file',
			},
		)

		// Get recent files
		const recentFiles = await umbreld.client.files.recents.query()

		// Verify the thumbnail property is included for the recent file - there will only be one recent file
		const recentImage = recentFiles[0]

		// Verify the thumbnail property is included for the recent file
		expect(recentImage?.thumbnail).toBeDefined()

		// Verify the thumbnail included is the same as the one generated above
		const thumbnailsFromDir = await fse.readdir(thumbnailDir)
		const thumbnail = thumbnailsFromDir[0]

		// Add api endpoint details for proper comparison
		const thumbnailWithApiEndpoint = `/api/files/thumbnail/${thumbnail}`
		expect(recentImage?.thumbnail).toBe(thumbnailWithApiEndpoint)
	})

	test('does not include thumbnail for a recent file without an existing thumbnail', async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/recents-thumbnail-test`
		await fse.ensureDir(testDir)

		// Copy the image file to the test directory
		await copyFixtureFile(testDir)

		await waitForThumbnailDebounce()

		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length === 1
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Watcher did not generate initial thumbnail',
			},
		)

		// Delete the thumbnail which will be the only file in the thumbnails directory
		const thumbnails = await fse.readdir(thumbnailDir)
		await fse.remove(`${thumbnailDir}/${thumbnails[0]}`)

		// Verify the thumbnail directory is empty
		const finalThumbnails = await fse.readdir(thumbnailDir)
		expect(finalThumbnails.length).toBe(0)

		// Get recent files
		const recentFiles = await umbreld.client.files.recents.query()

		// Verify the thumbnail property is not included for the recent file - there will only be one recent file
		expect(recentFiles[0].thumbnail).toBeUndefined()
	})
})

describe('Thumbnail housekeeping', () => {
	test('removes oldest thumbnails when exceeding cleanup threshold', {retry: 5}, async () => {
		// Set a lower maxThumbnailCount and pruningThreshold for testing
		const thumbnailsInstance = umbreld.instance.files.thumbnails
		thumbnailsInstance.maxThumbnailCount = 20
		thumbnailsInstance.pruningThreshold = 10

		// Create test images directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-cleanup-test`
		await fse.mkdir(testDir)

		// STEP 1: Create initial batch of images (just under threshold)
		// With maxThumbnailCount=20 and pruningThreshold=10, cleanup should happen at 30 images
		// So we create 29 images first (which shouldn't trigger cleanup)
		const initialBatchSize = 29
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Create first batch of images (29)
		for (let i = 0; i < initialBatchSize; i++) {
			await copyFixtureFile(testDir, 'master-lossless-image.png', `cleanup-${i}.png`)
		}

		// Wait for watcher to automatically create thumbnails for first batch
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length >= initialBatchSize
			},
			{
				timeoutMs: 15000,
				errorMessage: "Watcher didn't create expected thumbnails for first batch",
			},
		)

		// Count thumbnails after first batch
		const firstBatchThumbnails = await fse.readdir(thumbnailDir)

		// Verify no cleanup happened yet (we should have all 29 thumbnails)
		expect(firstBatchThumbnails.length).toBeGreaterThanOrEqual(initialBatchSize)

		// Wait a moment to ensure we're not in the middle of any operations
		await delay(500)

		// STEP 2: Create one more image to trigger cleanup
		// This should be the 30th image, which should trigger cleanup
		await copyFixtureFile(testDir, 'master-lossless-image.png', 'cleanup-trigger.png')

		// Wait for cleanup to complete
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length <= thumbnailsInstance.maxThumbnailCount && thumbnails.length > 0
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Cleanup did not complete within timeout period',
			},
		)

		// Get final thumbnail count
		const finalThumbnails = await fse.readdir(thumbnailDir)

		// Number of thumbnails should be equal to our test maxThumbnailCount
		expect(finalThumbnails.length).toBe(20)
	})

	test('removes excess thumbnails on startup', {retry: 5}, async () => {
		// Stop umbreld
		await umbreld.instance.stop()

		// Set a lower maxThumbnailCount for testing
		const maxThumbnailCount = 20
		umbreld.instance.files.thumbnails.maxThumbnailCount = maxThumbnailCount

		// Create the thumbnails directory if it doesn't exist already
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`
		await fse.ensureDir(thumbnailDir)

		// Create excess dummy thumbnail files (e.g., 40 files, which is double the max for this test)
		const totalThumbnailCount = maxThumbnailCount * 2

		// Create timestamps with increasing age to ensure deterministic pruning
		const now = Date.now()

		// Create dummy thumbnail files with controlled timestamps
		for (let i = 0; i < totalThumbnailCount; i++) {
			const thumbnailPath = `${thumbnailDir}/dummy-${i.toString().padStart(3, '0')}.webp`
			await fse.writeFile(thumbnailPath, 'dummy thumbnail content')

			// Set file timestamps - older files will be removed first
			// First half (0-19) will be older, second half (20-39) will be newer
			const fileTime = new Date(now - (totalThumbnailCount - i) * 1000)
			await fse.utimes(thumbnailPath, fileTime, fileTime)
		}

		// Verify we have the expected number of dummy thumbnails
		const initialThumbnails = await fse.readdir(thumbnailDir)
		expect(initialThumbnails.length).toBe(totalThumbnailCount)

		// Now start the umbrel instance - this should trigger the cleanup on startup
		await umbreld.instance.start()

		// Wait for cleanup to complete and verify
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length <= maxThumbnailCount
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Startup cleanup did not complete within timeout period',
			},
		)

		// Get final thumbnail count
		const finalThumbnails = await fse.readdir(thumbnailDir)

		// Number of thumbnails should be equal to maxThumbnailCount
		expect(finalThumbnails.length).toBe(maxThumbnailCount)

		// Verify the newer thumbnails were kept
		// The thumbnails with higher indices in their names should be kept
		// (these were the ones with newer timestamps)
		for (const thumbnail of finalThumbnails) {
			// Extract the index from the filename
			const match = thumbnail.match(/dummy-(\d+)\.webp/)
			if (match) {
				const index = parseInt(match[1], 10)
				// All kept thumbnails should be from the newer half (indices 20-39)
				expect(index).toBeGreaterThanOrEqual(totalThumbnailCount - maxThumbnailCount)
			}
		}
	})
})

describe('Queue selection', () => {
	test('uses background queue for watcher events and on-demand queue for explicit requests', {retry: 5}, async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-queue-test`
		await fse.ensureDir(testDir)

		// Track queue usage by spying on both queue's add method
		const thumbnailsInstance = umbreld.instance.files.thumbnails
		const backgroundAddSpy = vi.spyOn(thumbnailsInstance.backgroundQueue, 'add')
		const onDemandAddSpy = vi.spyOn(thumbnailsInstance.onDemandQueue, 'add')

		// Reset spy counts before test
		backgroundAddSpy.mockClear()
		onDemandAddSpy.mockClear()

		// PART 1: Test background queue is used for file watcher events

		// Copy the image file to trigger background watcher
		await copyFixtureFile(testDir)

		// Wait for the watcher to pick up the file and process it
		await pollUntil(
			async () => {
				return backgroundAddSpy.mock.calls.length > 0
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Background queue was not used for watcher-triggered thumbnail',
			},
		)

		// Verify background queue was used, but on-demand queue was not
		expect(backgroundAddSpy).toHaveBeenCalled()
		expect(onDemandAddSpy).not.toHaveBeenCalled()

		// Reset spy counts for second part of test
		backgroundAddSpy.mockClear()
		onDemandAddSpy.mockClear()

		// PART 2: Test on-demand queue is used for explicit thumbnail requests

		// delete the single thumbnail
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`
		let thumbnails = await fse.readdir(thumbnailDir)
		await fse.remove(`${thumbnailDir}/${thumbnails[0]}`)

		// Verify that thumbnails dir is empty
		thumbnails = await fse.readdir(thumbnailDir)
		expect(thumbnails.length).toBe(0)

		// request the thumbnail via the API
		const virtualPath = '/Home/thumbnail-queue-test/master-lossless-image.png'
		await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Verify that the thumbnail was generated
		thumbnails = await fse.readdir(thumbnailDir)
		expect(thumbnails.length).toBe(1)

		// Verify that the thumbnail was generated in the on-demand queue
		expect(onDemandAddSpy).toHaveBeenCalled()
		expect(backgroundAddSpy).not.toHaveBeenCalled()
	})
})
