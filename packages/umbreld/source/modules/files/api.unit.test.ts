import {once} from 'node:events'
import {readFile, rename, stat, utimes, writeFile} from 'node:fs/promises'
import nodePath from 'node:path'
import type {AddressInfo} from 'node:net'

import cookieParser from 'cookie-parser'
import express from 'express'
import got from 'got'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import type Umbreld from '../../index.js'
import {OWNER_ACCOUNT_ID} from '../auth/auth.js'
import UploadDiskPreflight from '../server/upload-disk-preflight.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import fileApi, {publishUploadWithoutReplacing, uploadLastModified} from './api.js'

describe('file API authentication boundaries', () => {
	const directory = temporaryDirectory()
	let server: ReturnType<express.Express['listen']>
	let origin: string
	let uploadDirectory: string

	beforeAll(async () => {
		await directory.createRoot()
		const thumbnailDirectory = await directory.create()
		uploadDirectory = await directory.create()
		const systemPrincipal = {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'} as const
		const umbreld = {
			auth: {
				authenticateDashboardCredentials: async (token: string) => {
					if (token !== 'system-token') throw new Error('Invalid credential')
					return systemPrincipal
				},
				authenticate: async (token: string, audience: string) => {
					if (token !== 'system-token' || audience !== 'dashboard') throw new Error('Invalid credential')
					return systemPrincipal
				},
				authorizeHttpApi: async () => systemPrincipal,
			},
			files: {
				thumbnails: {thumbnailDirectory},
				virtualToSystemPath: async (virtualPath: string) =>
					nodePath.join(uploadDirectory, nodePath.basename(virtualPath)),
				status: async () => ({type: 'file'}),
				authorizeWritableDestinationSystemPath: async () => {
					throw new Error('[cloud-read-only]')
				},
			},
		} as unknown as Umbreld

		const app = express()
		app.use(cookieParser())
		app.use(
			'/api/files',
			fileApi(
				umbreld,
				new UploadDiskPreflight({getAvailableBytes: async () => Number.MAX_SAFE_INTEGER, reserveBytes: 0}),
			),
		)
		server = app.listen(0, '127.0.0.1')
		await once(server, 'listening')
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		await directory.destroyRoot()
	})

	test.each([
		['GET', '/api/files/thumbnail/missing'],
		['GET', '/api/files/download'],
		['GET', '/api/files/view'],
		['POST', '/api/files/upload'],
		['GET', '/api/files/future-route-without-an-auth-policy'],
	] as const)('%s %s is denied before its file handler runs', async (method, path) => {
		const response = await got(`${origin}${path}`, {method, throwHttpErrors: false})
		expect(response.statusCode).toBe(401)
	})

	test('even a valid credential cannot reach a route without an explicit auth policy', async () => {
		const response = await got(`${origin}/api/files/future-route-without-an-auth-policy`, {
			headers: {Authorization: 'Bearer system-token'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(401)
	})

	test.each([
		['GET', '/api/files/thumbnail/missing', 404],
		['GET', '/api/files/download', 400],
		['GET', '/api/files/view', 400],
		['POST', '/api/files/upload', 400],
	] as const)('the local system credential can reach %s %s', async (method, path, statusCode) => {
		const response = await got(`${origin}${path}`, {
			method,
			headers: {Authorization: 'Bearer system-token'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(statusCode)
	})

	test('upload preserves the Cloud read-only policy error', async () => {
		const response = await got(`${origin}/api/files/upload?path=${encodeURIComponent('/Home/Cloud/blocked.txt')}`, {
			method: 'POST',
			headers: {Authorization: 'Bearer system-token'},
			body: 'blocked',
			throwHttpErrors: false,
		})

		expect(response.statusCode).toBe(400)
		expect(JSON.parse(response.body)).toEqual({error: '[cloud-read-only]'})
	})

	test.each(['', 'abc', '1.5', '0', '-86400000', '253402300800000', '1&lastModified=2'])(
		'upload rejects an invalid last-modified time before consuming the body: %s',
		async (lastModified) => {
			const response = await got(`${origin}/api/files/upload?path=%2FHome%2Fdated.txt&lastModified=${lastModified}`, {
				method: 'POST',
				headers: {Authorization: 'Bearer system-token'},
				body: 'dated',
				throwHttpErrors: false,
			})

			expect(response.statusCode).toBe(400)
			expect(JSON.parse(response.body)).toEqual({error: 'invalid lastModified parameter'})
		},
	)

	test.each(['/api/files/view', '/api/files/download'])(
		'%s revalidates a replacement that kept the size and modification time',
		async (route) => {
			const name = `${route.split('/').at(-1)}-revision.txt`
			const systemPath = nodePath.join(uploadDirectory, name)
			const time = new Date(Date.UTC(2015, 5, 1))
			await writeFile(systemPath, 'old!')
			await utimes(systemPath, time, time)
			const url = `${origin}${route}?path=${encodeURIComponent(`/Home/${name}`)}`
			const headers = {Authorization: 'Bearer system-token'}
			const first = await got(url, {headers})
			expect(first.body).toBe('old!')
			const etag = first.headers.etag!

			// An unchanged file still revalidates.
			const unchanged = await got(url, {headers: {...headers, 'If-None-Match': etag}, throwHttpErrors: false})
			expect(unchanged.statusCode).toBe(304)

			// Uploads publish a replacement as a new file carrying the original time.
			await writeFile(`${systemPath}.tmp`, 'new!')
			await utimes(`${systemPath}.tmp`, time, time)
			await rename(`${systemPath}.tmp`, systemPath)
			const replaced = await got(url, {headers: {...headers, 'If-None-Match': etag}, throwHttpErrors: false})
			expect(replaced.statusCode).toBe(200)
			expect(replaced.body).toBe('new!')
		},
	)

	test("reads the browser's last-modified time from an upload", () => {
		expect(uploadLastModified(undefined)).toBeUndefined()
		expect(uploadLastModified('1433160000000')).toBe(1433160000000)
	})

	test('publishes without clobbering when the destination filesystem has no hard links', async () => {
		const testDirectory = await directory.create()
		const temporaryPath = `${testDirectory}/upload.tmp`
		const destinationPath = `${testDirectory}/photo.jpg`
		await writeFile(temporaryPath, 'photo bytes')
		const unsupportedLink = async () => {
			throw Object.assign(new Error('hard links unsupported'), {code: 'EOPNOTSUPP'})
		}

		await publishUploadWithoutReplacing(temporaryPath, destinationPath, {createLink: unsupportedLink})

		await expect(readFile(destinationPath, 'utf8')).resolves.toBe('photo bytes')
		await expect(readFile(temporaryPath)).rejects.toMatchObject({code: 'ENOENT'})
	})

	test('the hard-link fallback gives the copy the requested modification time', async () => {
		const testDirectory = await directory.create()
		const temporaryPath = `${testDirectory}/upload.tmp`
		const destinationPath = `${testDirectory}/photo.jpg`
		await writeFile(temporaryPath, 'photo bytes')
		const unsupportedLink = async () => {
			throw Object.assign(new Error('hard links unsupported'), {code: 'EOPNOTSUPP'})
		}
		const modifiedMs = Date.UTC(2015, 5, 1)

		await publishUploadWithoutReplacing(temporaryPath, destinationPath, {createLink: unsupportedLink, modifiedMs})

		expect((await stat(destinationPath)).mtimeMs).toBe(modifiedMs)
	})

	test('the hard-link fallback never replaces an existing destination', async () => {
		const testDirectory = await directory.create()
		const temporaryPath = `${testDirectory}/upload.tmp`
		const destinationPath = `${testDirectory}/photo.jpg`
		await Promise.all([writeFile(temporaryPath, 'new bytes'), writeFile(destinationPath, 'existing bytes')])
		const unsupportedLink = async () => {
			throw Object.assign(new Error('hard links unsupported'), {code: 'EOPNOTSUPP'})
		}

		await expect(
			publishUploadWithoutReplacing(temporaryPath, destinationPath, {createLink: unsupportedLink}),
		).rejects.toMatchObject({code: 'EEXIST'})
		await expect(readFile(destinationPath, 'utf8')).resolves.toBe('existing bytes')
		await expect(readFile(temporaryPath, 'utf8')).resolves.toBe('new bytes')
	})
})
