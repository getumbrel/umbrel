import {expect, beforeAll, afterAll, test, describe} from 'vitest'

import fse from 'fs-extra'
import {delay} from 'es-toolkit'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

// This simulates a move across filesystems
process.env.UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS = 'true'
// This forces 100 KB/s copies so we can test progress
process.env.UMBRELD_FORCE_100KBS_COPY = 'true'

describe(`operationProgress()`, () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.operationProgress.query()).rejects.toThrow('Invalid token')
	})

	test('returns an empty array if no operations are in progress', async () => {
		await expect(umbreld.client.files.operationProgress.query()).resolves.toMatchObject([])
	})

	test('returns copy progress', async () => {
		// Create test directory and file
		const testDirectory = `${umbreld.instance.dataDirectory}/home/test-copy-progress`
		await fse.mkdir(testDirectory)
		await fse.mkdir(`${testDirectory}/source`)
		const KB = 1024
		await fse.writeFile(`${testDirectory}/source/source.bin`, Buffer.alloc(100 * KB))
		await fse.mkdir(`${testDirectory}/destination`)

		// Listen for all copy events
		// TODO: use actual tRPC subscriptions for this
		const collectedEvents: any[] = []
		const removeListener = umbreld.instance.eventBus.on(
			'files:operation-progress',
			(operations) => void collectedEvents.push(JSON.parse(JSON.stringify(operations))),
		)
		// Test we start with no operations in progress
		await expect(umbreld.client.files.operationProgress.query()).resolves.toMatchObject([])

		// Copy the file
		const copyPromise = umbreld.client.files.copy.mutate({
			path: '/Home/test-copy-progress/source/source.bin',
			toDirectory: '/Home/test-copy-progress/destination',
		})

		// Wait for the copy to start
		await delay(100)

		// Test we have a copy operation in progress
		await expect(umbreld.client.files.operationProgress.query()).resolves.toMatchObject([
			{
				type: 'copy',
				file: expect.objectContaining({
					path: '/Home/test-copy-progress/source/source.bin',
				}),
				destinationPath: '/Home/test-copy-progress/destination/source.bin',
				percent: expect.any(Number),
				bytesPerSecond: expect.any(Number),
			},
		])

		// Wait for the copy to complete
		const result = await copyPromise
		expect(result).toBe('/Home/test-copy-progress/destination/source.bin')

		// Test we end with no operations in progress
		await expect(umbreld.client.files.operationProgress.query()).resolves.toMatchObject([])

		// Test all the events we collected
		expect(collectedEvents.length).toBeGreaterThanOrEqual(3)
		expect(collectedEvents.at(0)).toMatchObject([
			{
				type: 'copy',
				file: expect.objectContaining({
					path: '/Home/test-copy-progress/source/source.bin',
				}),
				destinationPath: '/Home/test-copy-progress/destination/source.bin',
				percent: 0,
				bytesPerSecond: 0,
			},
		])
		expect(collectedEvents.at(-2)).toMatchObject([
			{
				type: 'copy',
				file: expect.objectContaining({
					path: '/Home/test-copy-progress/source/source.bin',
				}),
				destinationPath: '/Home/test-copy-progress/destination/source.bin',
				percent: 100,
				bytesPerSecond: expect.any(Number),
				secondsRemaining: 0,
			},
		])
		expect(collectedEvents.at(-1)).toMatchObject([])

		// Clean up
		removeListener()
		await fse.remove(testDirectory)
	})

	test('returns move progress during inter filesystem move', async () => {
		// Create test directory and file
		const testDirectory = `${umbreld.instance.dataDirectory}/home/test-move-progress`
		await fse.mkdir(testDirectory)
		await fse.mkdir(`${testDirectory}/source`)
		const KB = 1024
		await fse.writeFile(`${testDirectory}/source/source.bin`, Buffer.alloc(100 * KB))
		await fse.mkdir(`${testDirectory}/destination`)

		// Listen for all copy events
		// TODO: use actual tRPC subscriptions for this
		const collectedEvents: any[] = []
		const removeListener = umbreld.instance.eventBus.on(
			'files:operation-progress',
			(operations) => void collectedEvents.push(JSON.parse(JSON.stringify(operations))),
		)
		// Test we start with no operations in progress
		await expect(umbreld.client.files.operationProgress.query()).resolves.toMatchObject([])

		// Move the file
		const movePromise = umbreld.client.files.move.mutate({
			path: '/Home/test-move-progress/source/source.bin',
			toDirectory: '/Home/test-move-progress/destination',
		})

		// Wait for the move to start
		await delay(100)

		// Test we have a move operation in progress
		await expect(umbreld.client.files.operationProgress.query()).resolves.toMatchObject([
			{
				type: 'move',
				file: expect.objectContaining({
					path: '/Home/test-move-progress/source/source.bin',
				}),
				destinationPath: '/Home/test-move-progress/destination/source.bin',
				percent: expect.any(Number),
				bytesPerSecond: expect.any(Number),
			},
		])

		// Wait for the move to complete
		const result = await movePromise
		expect(result).toBe('/Home/test-move-progress/destination/source.bin')

		// Test we end with no operations in progress
		await expect(umbreld.client.files.operationProgress.query()).resolves.toMatchObject([])

		// Test all the events we collected
		expect(collectedEvents.length).toBeGreaterThanOrEqual(3)
		expect(collectedEvents.at(0)).toMatchObject([
			{
				type: 'move',
				file: expect.objectContaining({
					path: '/Home/test-move-progress/source/source.bin',
				}),
				destinationPath: '/Home/test-move-progress/destination/source.bin',
				percent: 0,
				bytesPerSecond: 0,
			},
		])
		expect(collectedEvents.at(-2)).toMatchObject([
			{
				type: 'move',
				file: expect.objectContaining({
					path: '/Home/test-move-progress/source/source.bin',
				}),
				destinationPath: '/Home/test-move-progress/destination/source.bin',
				percent: 100,
				bytesPerSecond: expect.any(Number),
				secondsRemaining: 0,
			},
		])
		expect(collectedEvents.at(-1)).toMatchObject([])

		// Clean up
		removeListener()
		await fse.remove(testDirectory)
	})
})
