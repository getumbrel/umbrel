import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import nodePath from 'node:path'

import express from 'express'
import fse from 'fs-extra'
import got from 'got'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import Umbreld from '../../index.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import createAppAuthRouter, {rewriteAppAuthDevProxyPath} from './app-auth.ts'

const accountAvatarPath = (umbreld: Umbreld, userId: string, hash: string) =>
	nodePath.join(umbreld.dataDirectory, 'avatars', userId, `${hash}.webp`)

describe('app auth development proxy', () => {
	test.each([
		['/', '/app-auth/'],
		['/?origin=host&app=files', '/app-auth/?origin=host&app=files'],
		['/app-auth', '/app-auth/'],
		['/app-auth?origin=host', '/app-auth/?origin=host'],
		['/app-auth/', '/app-auth/'],
		['/app-auth/?origin=tor', '/app-auth/?origin=tor'],
		['/app-auth/src/app-auth.tsx', '/src/app-auth.tsx'],
		['/app-auth/@vite/client?direct', '/@vite/client?direct'],
		['/src/app-auth.tsx', '/src/app-auth.tsx'],
		['/@vite/client', '/@vite/client'],
	])('rewrites %s to %s', (input, expected) => {
		expect(rewriteAppAuthDevProxyPath(input)).toBe(expected)
	})
})

describe('app auth account avatars', () => {
	const directory = temporaryDirectory()
	const hash = 'a'.repeat(64)
	const image = Buffer.from('app-auth-avatar')
	let server: ReturnType<express.Express['listen']>
	let origin: string

	beforeAll(async () => {
		await directory.createRoot()
		const umbreld = new Umbreld({dataDirectory: await directory.create()})
		await umbreld.store.set('user', {
			name: 'Owner',
			hashedPassword: 'unused',
			wallpaper: '16',
			avatarHash: hash,
		})
		await fse.outputFile(accountAvatarPath(umbreld, '0', hash), image)

		const app = express()
		app.use(createAppAuthRouter(umbreld))
		server = app.listen(0, '127.0.0.1')
		await once(server, 'listening')
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		await directory.destroyRoot()
	})

	test('returns app-auth-relative account URLs without exposing storage metadata', async () => {
		const response = await got(`${origin}/v1/account/accounts`, {responseType: 'json'})
		expect(response.headers['cache-control']).toBe('no-store')
		expect(response.body).toEqual([
			expect.objectContaining({
				userId: '0',
				wallpaper: {id: '16', brandColorHsl: '265 100% 42%'},
				avatarUrl: `/v1/account/avatar/0/${hash}.webp`,
			}),
		])
		expect(JSON.stringify(response.body)).not.toContain('avatarHash')
	})

	test('serves the same immutable bytes without inheriting the JSON no-store policy', async () => {
		const response = await got(`${origin}/v1/account/avatar/0/${hash}.webp`, {responseType: 'buffer'})
		expect(response.body).toEqual(image)
		expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable')
		expect(response.headers.etag).toBe(`"${hash}"`)
		expect(response.headers['x-content-type-options']).toBe('nosniff')
	})

	test('returns the account wallpaper appearance', async () => {
		const response = await got(`${origin}/v1/account/wallpaper`, {responseType: 'json'})
		expect(response.body).toEqual({id: '16', brandColorHsl: '265 100% 42%'})
	})
})
