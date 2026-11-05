import {createHash} from 'node:crypto'
import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import nodePath from 'node:path'

import cookieParser from 'cookie-parser'
import express from 'express'
import {execa} from 'execa'
import fse from 'fs-extra'
import got from 'got'
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'

import Umbreld from '../../index.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import {OWNER_ACCOUNT_ID, type Principal} from '../auth/auth.ts'
import {BROWSER_SESSION_HTTP_COOKIE_NAME} from '../auth/browser-session-cookie.ts'
import accountAvatarApi, {accountAvatarUrl, authorizeAccountAvatarWrite, serializeAccountAvatar} from './avatar-api.ts'

vi.mock('execa', async (importOriginal) => ({
	...(await importOriginal<typeof import('execa')>()),
	execa: vi.fn(),
}))

const accountAvatarPath = (umbreld: Umbreld, userId: string, hash: string) =>
	nodePath.join(umbreld.dataDirectory, 'avatars', userId, `${hash}.webp`)
const jpegUpload = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const canonicalWebp = Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBP'), Buffer.from('canonical')])

describe('avatar HTTP representation', () => {
	const hash = 'a'.repeat(64)
	const account = {userId: 'Alice', name: 'Alice', language: 'en', avatarHash: hash}

	test('generates dashboard and app-auth URLs and strips storage metadata', () => {
		expect(accountAvatarUrl('Alice', hash)).toBe(`/api/accounts/Alice/avatar/${hash}.webp`)
		expect(accountAvatarUrl('Alice', hash, 'app-auth')).toBe(`/v1/account/avatar/Alice/${hash}.webp`)

		const dashboard = serializeAccountAvatar(account)
		const appAuth = serializeAccountAvatar(account, 'app-auth')
		expect(dashboard).toEqual({
			userId: 'Alice',
			name: 'Alice',
			language: 'en',
			avatarUrl: `/api/accounts/Alice/avatar/${hash}.webp`,
		})
		expect(appAuth).toEqual({...dashboard, avatarUrl: `/v1/account/avatar/Alice/${hash}.webp`})
		expect(JSON.stringify([dashboard, appAuth])).not.toContain('avatarHash')
	})
})

describe('avatar authorization', () => {
	const owner = {sessionId: 'owner', accountId: OWNER_ACCOUNT_ID, actor: 'account'} as const
	const alice = {sessionId: 'alice', accountId: 'Alice', actor: 'account'} as const
	const system = {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'} as const
	let directory: ReturnType<typeof temporaryDirectory>
	let umbreld: Umbreld

	beforeAll(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		umbreld = new Umbreld({dataDirectory: await directory.create()})
		await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused'})
		await umbreld.store.set('members', [
			{id: 'Alice', name: 'Alice', hashedPassword: 'unused', language: 'en'},
			{id: 'Bob', name: 'Bob', hashedPassword: 'unused', language: 'en'},
			{id: 'Deleted', deleted: true},
		])
	})

	afterAll(async () => directory.destroyRoot())

	test.each([
		[owner, '0'],
		[owner, 'Alice'],
		[alice, 'Alice'],
	] as [Principal, string][])('%s can modify %s', async (principal, userId) => {
		await expect(authorizeAccountAvatarWrite(umbreld, principal, userId)).resolves.toBe(principal)
	})

	test.each([
		[alice, '0'],
		[alice, 'Bob'],
		[system, '0'],
	] as [Principal, string][])('%s cannot modify %s', async (principal, userId) => {
		await expect(authorizeAccountAvatarWrite(umbreld, principal, userId)).rejects.toMatchObject({statusCode: 403})
	})

	test.each(['Missing', 'Deleted'])('owner cannot modify missing/tombstoned account %s', async (userId) => {
		await expect(authorizeAccountAvatarWrite(umbreld, owner, userId)).rejects.toMatchObject({statusCode: 404})
	})
})

describe('avatar write responses', () => {
	const directory = temporaryDirectory()
	let umbreld: Umbreld
	let server: ReturnType<express.Express['listen']>
	let origin: string
	let headers: {authorization: string; cookie: string}

	beforeAll(async () => {
		await directory.createRoot()
		umbreld = new Umbreld({dataDirectory: await directory.create()})
		await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused'})
		await umbreld.auth.start()
		const session = await umbreld.auth.createSession()
		headers = {
			authorization: `Bearer ${session.dashboardToken}`,
			cookie: `${BROWSER_SESSION_HTTP_COOKIE_NAME}=${session.browserSessionToken}`,
		}

		vi.mocked(execa).mockImplementation((async (command: string, args: readonly string[]) => {
			if (command === 'identify') {
				const source = args.at(-1) ?? ''
				return {stdout: source.includes('.tmp.webp') ? 'WEBP 512 512' : 'JPEG 640 480'}
			}
			if (command === 'convert') {
				await fse.writeFile(args.at(-1)!, canonicalWebp)
				return {stdout: ''}
			}
			throw new Error(`Unexpected command: ${command}`)
		}) as any)

		const app = express()
		app.use(cookieParser())
		app.use('/api/accounts', accountAvatarApi(umbreld))
		server = app.listen(0, '127.0.0.1')
		await once(server, 'listening')
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		await umbreld.auth.stop()
		await directory.destroyRoot()
		vi.mocked(execa).mockReset()
	})

	test('returns the public content-addressed URL after a successful PUT', async () => {
		const hash = createHash('sha256').update(canonicalWebp).digest('hex')
		const response = await got.put(`${origin}/api/accounts/0/avatar`, {
			body: jpegUpload,
			headers,
			responseType: 'json',
		})

		expect(response.body).toEqual({userId: '0', avatarUrl: `/api/accounts/0/avatar/${hash}.webp`})
		expect(response.headers['cache-control']).toBe('no-store')
		expect(await umbreld.user.getAccountAvatarHash('0')).toBe(hash)
	})

	test('returns the fallback state after a successful DELETE', async () => {
		const response = await got.delete(`${origin}/api/accounts/0/avatar`, {headers, responseType: 'json'})

		expect(response.body).toEqual({userId: '0', avatarUrl: null})
		expect(response.headers['cache-control']).toBe('no-store')
		expect(await umbreld.user.getAccountAvatarHash('0')).toBeUndefined()
	})
})

describe('public dashboard avatar responses', () => {
	const directory = temporaryDirectory()
	let umbreld: Umbreld
	let server: ReturnType<express.Express['listen']>
	let origin: string
	const hash = 'd'.repeat(64)
	const image = Buffer.from('canonical-webp')

	beforeAll(async () => {
		await directory.createRoot()
		umbreld = new Umbreld({dataDirectory: await directory.create()})
		await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused', avatarHash: hash})
		await fse.outputFile(accountAvatarPath(umbreld, '0', hash), image)

		const app = express()
		app.use('/api/accounts', accountAvatarApi(umbreld))
		server = app.listen(0, '127.0.0.1')
		await once(server, 'listening')
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		await directory.destroyRoot()
	})

	test('serves only the active canonical bytes with immutable private caching and security headers', async () => {
		const response = await got(`${origin}/api/accounts/0/avatar/${hash}.webp`, {responseType: 'buffer'})
		expect(response.body).toEqual(image)
		expect(response.headers['content-type']).toContain('image/webp')
		expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable')
		expect(response.headers.etag).toBe(`"${hash}"`)
		expect(response.headers['x-content-type-options']).toBe('nosniff')
	})

	test.each(['bad', 'e'.repeat(64)])(
		'returns a generic no-store 404 for malformed or stale hash %s',
		async (staleHash) => {
			const response = await got(`${origin}/api/accounts/0/avatar/${staleHash}.webp`, {throwHttpErrors: false})
			expect(response.statusCode).toBe(404)
			expect(response.headers['cache-control']).toBe('no-store')
			expect(JSON.parse(response.body)).toEqual({error: 'Not found'})
		},
	)

	test('stops serving an avatar as soon as the member is tombstoned', async () => {
		await umbreld.store.set('members', [
			{id: 'Alice', name: 'Alice', hashedPassword: 'unused', language: 'en', avatarHash: hash},
		])
		await fse.outputFile(accountAvatarPath(umbreld, 'Alice', hash), image)
		await umbreld.store.set('members', [{id: 'Alice', deleted: true}])

		const response = await got(`${origin}/api/accounts/Alice/avatar/${hash}.webp`, {throwHttpErrors: false})
		expect(response.statusCode).toBe(404)
		expect(response.headers['cache-control']).toBe('no-store')
	})

	test('rejects unauthenticated writes before reading the body', async () => {
		const response = await got.put(`${origin}/api/accounts/0/avatar`, {
			body: 'blocked',
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(401)
		expect(response.headers['cache-control']).toBe('no-store')
		expect(response.headers.connection).toBe('close')
	})
})
