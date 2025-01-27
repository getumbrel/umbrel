import {setTimeout as sleep} from 'node:timers/promises'
import nodePath from 'node:path'

import {expect, beforeAll, afterAll, test} from 'vitest'
import {$} from 'execa'
import fse from 'fs-extra'

import createTestUmbreld from '../../../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
})

afterAll(async () => {
	await umbreld.cleanup()
})

// The following tests are stateful and must be run in order

// We sleep to allow time for fs events to be triggered and handled by the
// umbreld filewatcher and thumbnail generator.
const waitForWatcher = 1500
const waitForWatcherAndGeneratorMs = waitForWatcher + 3000

test.sequential('pollThumbnails() throws invalid error whithout auth token', async () => {
	await expect(umbreld.client.files.pollThumbnails.query({paths: []})).rejects.toThrow('Invalid token')
})

test.sequential('login', async () => {
	await expect(umbreld.registerAndLogin()).resolves.toBe(true)
})

test.sequential('pollThumbnails() returns any empty array when no paths are provided', async () => {
	await expect(umbreld.client.files.pollThumbnails.query({paths: []})).resolves.toMatchObject([])
})

test.sequential('pollThumbnails() returns null times for inexistent thumbnails', async () => {
	await expect(
		umbreld.client.files.pollThumbnails.query({paths: ['/Home/DoesNotExist1.jpg', '/Home/DoesNotExist2.jpg']}),
	).resolves.toMatchObject([
		{
			path: '/Home/DoesNotExist1.jpg',
			time: null,
		},
		{
			path: '/Home/DoesNotExist2.jpg',
			time: null,
		},
	])
})

test.sequential('pollThumbnails() returns times of recently generated thumbnails', async () => {
	// ui directory inside of umbreld directory
	const uiDirectoryProduction = new URL('../../../../../ui', import.meta.url).pathname
	// ui directory next to umbreld directory
	const uiDirectoryDevelopment = new URL('../../../../../../ui', import.meta.url).pathname

	let testImagePath = nodePath.join(uiDirectoryProduction, 'public', 'favicon', 'android-chrome-512x512.png')
	if (!(await fse.pathExists(testImagePath))) {
		testImagePath = nodePath.join(uiDirectoryDevelopment, 'public', 'favicon', 'android-chrome-512x512.png')
	}
	const timeBefore = new Date()
	await sleep(1000)
	await $`cp ${testImagePath} ${umbreld.instance.files.homeDirectory}/Test1.png`
	await $`cp ${testImagePath} ${umbreld.instance.files.homeDirectory}/Test2.png`
	await sleep(waitForWatcherAndGeneratorMs)
	const query = umbreld.client.files.pollThumbnails.query({paths: ['/Home/Test1.png', '/Home/Test2.png']})
	await expect(query).resolves.toMatchObject([
		{
			path: '/Home/Test1.png',
			time: expect.any(String),
		},
		{
			path: '/Home/Test2.png',
			time: expect.any(String),
		},
	])
	const response = await query
	for (let i = 0; i < 2; ++i) {
		const thumbnailTime = new Date(response[i].time!)
		await expect(thumbnailTime.getTime()).toBeGreaterThan(timeBefore.getTime())
	}
})

test.sequential('pollThumbnails() returns times of recently modified thumbnails', async () => {
	const timeBefore = new Date()
	await sleep(1000)
	await $`touch ${umbreld.instance.files.homeDirectory}/Test1.png`
	await sleep(waitForWatcherAndGeneratorMs)
	const query = umbreld.client.files.pollThumbnails.query({paths: ['/Home/Test1.png', '/Home/Test2.png']})
	await expect(query).resolves.toMatchObject([
		{
			path: '/Home/Test1.png',
			time: expect.any(String),
		},
		{
			path: '/Home/Test2.png',
			time: expect.any(String),
		},
	])
	const response = await query
	const thumbnailTime = new Date(response[0].time!)
	await expect(thumbnailTime.getTime()).toBeGreaterThan(timeBefore.getTime())
})

test.sequential('pollThumbnails() returns null times for recently deleted thumbnails', async () => {
	await $`rm ${umbreld.instance.files.homeDirectory}/Test1.png`
	await sleep(waitForWatcher)
	const query = umbreld.client.files.pollThumbnails.query({paths: ['/Home/Test1.png', '/Home/Test2.png']})
	await expect(query).resolves.toMatchObject([
		{path: '/Home/Test1.png', time: null},
		{path: '/Home/Test2.png', time: expect.any(String)},
	])
})
