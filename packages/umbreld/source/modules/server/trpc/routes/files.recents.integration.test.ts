import {setTimeout as sleep} from 'node:timers/promises'

import {expect, beforeAll, afterAll, test} from 'vitest'
import {$} from 'execa'

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
// umbreld filewatcher. Must be longer than stability threshold.
const waitForWatcherMs = 1500

test.sequential('recents() throws invalid error whithout auth token', async () => {
	await expect(umbreld.client.files.recents.query()).rejects.toThrow('Invalid token')
})

test.sequential('login', async () => {
	await expect(umbreld.registerAndLogin()).resolves.toBe(true)
})

test.sequential('recents() lists nothing on a fresh install', async () => {
	await expect(umbreld.client.files.recents.query()).resolves.toMatchObject([])
})

test.sequential('recents() shows a recently created file', async () => {
	await $`touch ${umbreld.instance.files.homeDirectory}/file-1`
	await sleep(waitForWatcherMs)
	await expect(umbreld.client.files.recents.query()).resolves.toMatchObject([{path: '/Home/file-1'}])
})

test.sequential('recents() removes deleted files', async () => {
	await $`rm ${umbreld.instance.files.homeDirectory}/file-1`
	await sleep(waitForWatcherMs)
	await expect(umbreld.client.files.recents.query()).resolves.toMatchObject([])
})

test.sequential('recents() maintains order with newest files first', async () => {
	// Create multiple files
	await $`touch ${umbreld.instance.files.homeDirectory}/file-2`
	await sleep(100)
	await $`touch ${umbreld.instance.files.homeDirectory}/file-3`
	await sleep(waitForWatcherMs)

	await expect(umbreld.client.files.recents.query()).resolves.toMatchObject([
		{path: '/Home/file-3'},
		{path: '/Home/file-2'},
	])
})

test.sequential('recents() updates when files are modified', async () => {
	await $`touch ${umbreld.instance.files.homeDirectory}/file-2`
	await sleep(waitForWatcherMs)
	await expect(umbreld.client.files.recents.query()).resolves.toMatchObject([
		{path: '/Home/file-2'},
		{path: '/Home/file-3'},
	])
})

test.sequential('recents() respects maxRecents limit', async () => {
	// Create more files than the limit (50)
	for (let i = 1; i <= 60; i++) {
		await $`touch ${umbreld.instance.files.homeDirectory}/file-${i}`
	}
	await sleep(waitForWatcherMs)

	const recents = await umbreld.client.files.recents.query()
	expect(recents).toHaveLength(50) // Max limit from recents.ts
})

test.sequential('recents() ignores .DS_Store files', async () => {
	await $`touch ${umbreld.instance.files.homeDirectory}/.DS_Store`
	await sleep(waitForWatcherMs)
	const recents = await umbreld.client.files.recents.query()
	expect(recents.some((file) => file.path.endsWith('.DS_Store'))).toBe(false)
})

test.sequential('recents() ignores .directory files', async () => {
	await $`touch ${umbreld.instance.files.homeDirectory}/.directory`
	await sleep(waitForWatcherMs)
	const recents = await umbreld.client.files.recents.query()
	expect(recents.some((file) => file.path.endsWith('.directory'))).toBe(false)
})
