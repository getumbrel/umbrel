import {mkdir, truncate, writeFile} from 'node:fs/promises'
import nodePath from 'node:path'

import {afterEach, expect, test, vi} from 'vitest'

import temporaryDirectory from '../utilities/temporary-directory.ts'
import ModelDownloads, {MODELS} from './models.ts'

const temporary = temporaryDirectory()
const GiB = 1024 ** 3
const logger = {log() {}, error() {}}

afterEach(async () => {
	vi.restoreAllMocks()
	await temporary.destroyRoot()
})

// One try at fetching the models with this much room free, and whether it was left for want of room
async function tried(directory: string, free: number) {
	const downloads = new ModelDownloads({directory, logger, onInstalled() {}, free: async () => free})
	downloads.ensure()
	await downloads.stop()
	return downloads.shortOfRoom
}

test('fetches nothing unless the models fit with 5 GB to spare', async () => {
	const fetched = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
	const directory = await temporary.create()
	const all = MODELS.reduce((sum, {size}) => sum + size, 0)

	expect(await tried(directory, all + 5 * GiB - 1)).toBe(true)
	expect(fetched).not.toHaveBeenCalled()
	expect(await tried(directory, all + 5 * GiB)).toBe(false)
})

test('only what is not on the device yet has to fit', async () => {
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
	const directory = await temporary.create()
	// Every model but the largest is here already, and the first megabyte of that one
	const largest = MODELS.reduce((first, second) => (second.size > first.size ? second : first))
	for (const {file, size} of MODELS) {
		if (file === largest.file) continue
		await mkdir(nodePath.dirname(nodePath.join(directory, file)), {recursive: true})
		await writeFile(nodePath.join(directory, file), '')
		await truncate(nodePath.join(directory, file), size)
	}
	await mkdir(nodePath.dirname(nodePath.join(directory, largest.file)), {recursive: true})
	await writeFile(nodePath.join(directory, `${largest.file}.partial`), Buffer.alloc(1024 ** 2))
	const missing = largest.size - 1024 ** 2

	expect(await tried(directory, missing + 5 * GiB - 1)).toBe(true)
	expect(await tried(directory, missing + 5 * GiB)).toBe(false)
})
