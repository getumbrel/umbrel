import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import {join} from 'node:path'

import express from 'express'
import fse from 'fs-extra'
import {afterAll, beforeAll, expect, test, vi} from 'vitest'

import temporaryDirectory from '../utilities/temporary-directory.js'
import createErrorHandler from './error-handler.js'

const directory = temporaryDirectory()
const immutableCacheControl = 'public, max-age=31536000, immutable'
const assetPaths = ['/assets/machines/machine-android-off.webp', '/wallpapers/1.jpg']
const image = Buffer.from('image fixture')
let server: ReturnType<express.Express['listen']>
let origin: string

beforeAll(async () => {
	await directory.createRoot()
	const uiPath = await directory.create()
	for (const path of assetPaths) await fse.outputFile(join(uiPath, path), image)

	const app = express()
	// Match the dashboard's cache policy, which is applied before serving files.
	app.get(['/assets/*', '/wallpapers/*'], (_request, response, next) => {
		response.set('Cache-Control', immutableCacheControl)
		next()
	})
	app.get('/assets/error', () => {
		throw new Error('Asset unavailable')
	})
	app.use(express.static(uiPath))
	app.use(createErrorHandler({error: vi.fn()}))
	server = app.listen(0, '127.0.0.1')
	await once(server, 'listening')
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
	await directory.destroyRoot()
})

test('replaces the immutable cache policy when an asset handler throws', async () => {
	const response = await fetch(`${origin}/assets/error`)
	expect(response.status).toBe(500)
	expect(response.headers.get('cache-control')).toBe('no-store')
	expect(await response.json()).toEqual({error: true})
})

test.each(assetPaths)('does not cache a file-serving error for %s and preserves caching on recovery', async (path) => {
	// An unsatisfiable range makes express.static fail after it prepares the
	// file's response headers, exercising the same error path as a read failure.
	const failed = await fetch(`${origin}${path}`, {headers: {Range: 'bytes=99999999-'}})
	expect(failed.status).toBe(500)
	expect(failed.headers.get('cache-control')).toBe('no-store')
	expect(await failed.json()).toEqual({error: true})

	const recovered = await fetch(`${origin}${path}`)
	expect(recovered.status).toBe(200)
	expect(recovered.headers.get('cache-control')).toBe(immutableCacheControl)
	expect(Buffer.from(await recovered.arrayBuffer())).toEqual(image)
})
