import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import {join} from 'node:path'

import express from 'express'
import fse from 'fs-extra'
import {afterAll, beforeAll, expect, test} from 'vitest'

import temporaryDirectory from '../utilities/temporary-directory.ts'
import {PUBLIC_IMMUTABLE_CACHE_CONTROL, uiStaticOptions} from './cache-control.ts'

const directory = temporaryDirectory()
let server: ReturnType<express.Express['listen']>
let origin: string

beforeAll(async () => {
	await directory.createRoot()
	const uiPath = await directory.create()
	for (const path of [
		'index.html',
		'assets/build/index-abc123.js',
		'assets/wallpapers/1.jpg',
		'assets/dock/files.webp',
	]) {
		await fse.outputFile(join(uiPath, path), path)
	}

	const app = express()
	app.use(express.static(uiPath, uiStaticOptions(uiPath)))
	server = app.listen(0, '127.0.0.1')
	await once(server, 'listening')
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
	await directory.destroyRoot()
})

test.each([
	['the build output', '/assets/build/index-abc123.js'],
	['an asset versioned with its hash', '/assets/wallpapers/1.jpg?v=0123456789ab'],
])('caches %s for good', async (_, path) => {
	const response = await fetch(`${origin}${path}`)
	expect(response.status).toBe(200)
	expect(response.headers.get('cache-control')).toBe(PUBLIC_IMMUTABLE_CACHE_CONTROL)
})

test.each([
	['an unversioned asset', '/assets/dock/files.webp'],
	['an unversioned wallpaper', '/assets/wallpapers/1.jpg'],
	['the dashboard', '/index.html'],
	// Pinning a dashboard for a year would keep it pointing at chunks an OTA update removed
	['the dashboard with a version in the URL', '/index.html?v=1'],
])('revalidates %s', async (_, path) => {
	const response = await fetch(`${origin}${path}`)
	expect(response.status).toBe(200)
	expect(response.headers.get('cache-control')).toBe('public, max-age=0')
	expect(response.headers.get('etag')).toBeTruthy()
})
