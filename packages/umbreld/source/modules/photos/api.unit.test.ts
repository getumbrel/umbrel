import {once} from 'node:events'
import {mkdtemp, open, rm, stat, writeFile} from 'node:fs/promises'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import cookieParser from 'cookie-parser'
import express from 'express'
import got from 'got'
import {afterAll, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import UploadDiskPreflight from '../server/upload-disk-preflight.js'
import photosApi from './api.js'

describe('Photos HTTP account boundaries', () => {
	let server: ReturnType<express.Express['listen']>
	let origin: string
	let directory: string
	const resolveThumbnailRequest = vi.fn()
	const prepareUpload = vi.fn()
	const registerUpload = vi.fn()

	beforeAll(async () => {
		directory = await mkdtemp(nodePath.join(tmpdir(), 'photos-api-'))
		await Promise.all([
			writeFile(nodePath.join(directory, 'owner.jpg'), 'owner-original'),
			writeFile(nodePath.join(directory, 'member.jpg'), 'member-original'),
			writeFile(nodePath.join(directory, 'member.mov'), 'member-live'),
			writeFile(nodePath.join(directory, 'member.insv'), 'member-360-video'),
			writeFile(nodePath.join(directory, 'member.webp'), 'member-thumbnail'),
		])
		const principal = (accountId: string) => ({sessionId: accountId, accountId, actor: 'system' as const})
		const item = (accountId: string, id: string) => {
			if (accountId === 'owner' && id === 'owner-item') return {id, path: '/Home/owner.jpg'}
			if (accountId === 'member' && id === 'member-item') return {id, path: '/Users/member/member.jpg'}
			if (accountId === 'member' && id === 'member-video') return {id, path: '/Users/member/member.insv'}
		}
		const umbreld = {
			auth: {
				authenticate: async (token: string) => principal(token),
				authenticateDashboardCredentials: async (token: string) => principal(token),
				authorizeHttpApi: async (authenticated: unknown) => authenticated,
			},
			photos: {
				resolveItem: async (accountId: string, id: string) => item(accountId, id),
				resolveLiveCompanion: async (accountId: string, id: string) =>
					accountId === 'member' && id === 'member-item'
						? {id: 'member-motion', path: '/Users/member/member.mov'}
						: undefined,
				consumeDownloadTicket: (accountId: string, ticket: string) => {
					if (accountId === 'member' && ticket === 'member-download') return ['member-item']
					if (accountId === 'member' && ticket === 'mixed-download') return ['member-item', 'owner-item']
				},
				listAlbums: async () => [{id: 'album'}],
				prepareUpload,
				registerUpload,
			},
			files: {
				virtualToSystemPath: async (path: string, accountId: string) => {
					if (accountId === 'owner' && path === '/Home/owner.jpg') return nodePath.join(directory, 'owner.jpg')
					if (accountId === 'member' && path === '/Users/member/member.jpg')
						return nodePath.join(directory, 'member.jpg')
					if (accountId === 'member' && path === '/Users/member/member.mov')
						return nodePath.join(directory, 'member.mov')
					if (accountId === 'member' && path === '/Users/member/member.insv')
						return nodePath.join(directory, 'member.insv')
					if (accountId === 'member' && path.startsWith('/Users/member/Photos/')) {
						return nodePath.join(directory, 'member-home', 'Photos', nodePath.basename(path))
					}
					throw new Error('unauthorized path')
				},
				openFileForRead: async (path: string, accountId: string) => {
					const systemPath = await (umbreld as unknown as Umbreld).files.virtualToSystemPath(path, accountId)
					const handle = await open(systemPath, 'r')
					return {
						handle,
						stats: await handle.stat({bigint: true}),
						virtualPath: path,
						systemPath,
						name: nodePath.basename(systemPath),
					}
				},
				authorizeWritableDestinationSystemPath: async (path: string) => path,
				getUniqueName: async (path: string) => path.replace(/(\.[^.]+)$/, ' (2)$1'),
				systemToVirtualPath: (path: string) => `/Users/member/Photos/${nodePath.basename(path)}`,
				isInternalStorageVirtualPath: () => false,
				chownSystemPath: async () => {},
				fileIndex: {movePath: async () => {}},
				logger: {error: vi.fn()},
				thumbnails: {
					getThumbnailOnDemand: async () =>
						'/api/files/thumbnail/content-preview-192-webp-v1-hash.webp?path=%2FUsers%2Fmember%2Fmember.jpg',
					resolveThumbnailRequest: resolveThumbnailRequest.mockResolvedValue(nodePath.join(directory, 'member.webp')),
				},
			},
		} as unknown as Umbreld

		const app = express()
		app.use(cookieParser())
		app.use(
			'/api/photos',
			photosApi(
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
		await rm(directory, {recursive: true, force: true})
	})

	beforeEach(() => {
		prepareUpload.mockReset().mockResolvedValue('duplicate')
		registerUpload.mockReset().mockResolvedValue('imported')
	})

	test.each([
		['GET', '/api/photos/thumb/member-item?s=192'],
		['GET', '/api/photos/original/member-item'],
		['GET', '/api/photos/live/member-item'],
		['GET', '/api/photos/download?ticket=member-download'],
		['POST', '/api/photos/upload?name=photo.jpg'],
		['GET', '/api/photos/future-route'],
	] as const)('%s %s is denied without credentials', async (method, path) => {
		const response = await got(`${origin}${path}`, {method, throwHttpErrors: false})
		expect(response.statusCode).toBe(401)
	})

	test.each([
		['/api/photos/thumb/member-item?s=192'],
		['/api/photos/original/member-item'],
		['/api/photos/live/member-item'],
		['/api/photos/download?ticket=member-download'],
	] as const)('an owner credential cannot resolve a member media URL: %s', async (path) => {
		const response = await got(`${origin}${path}`, {
			headers: {Authorization: 'Bearer owner'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(404)
	})

	test('a member can fetch only its own thumbnail, original, live clip, and download', async () => {
		const headers = {Authorization: 'Bearer member'}
		const [thumbnail, original, originalDownload, live, download] = await Promise.all([
			got(`${origin}/api/photos/thumb/member-item?s=192`, {headers}),
			got(`${origin}/api/photos/original/member-item`, {headers}),
			got(`${origin}/api/photos/original/member-item?download`, {headers}),
			got(`${origin}/api/photos/live/member-item`, {headers}),
			got(`${origin}/api/photos/download?ticket=member-download`, {headers}),
		])
		expect(thumbnail.body).toBe('member-thumbnail')
		expect(original.body).toBe('member-original')
		expect(originalDownload.body).toBe('member-original')
		expect(live.body).toBe('member-live')
		expect(download.body).toBe('member-original')
		expect(thumbnail.headers['cache-control']).toBe('private, max-age=31536000, immutable')
		expect(original.headers['cache-control']).toBe('private, max-age=31536000, immutable')
		expect(originalDownload.headers['cache-control']).toBe('private, max-age=31536000, immutable')
		expect(live.headers['cache-control']).toBeUndefined()
		expect(download.headers['cache-control']).toBeUndefined()
		expect(resolveThumbnailRequest).toHaveBeenCalledWith(
			'content-preview-192-webp-v1-hash.webp',
			'/Users/member/member.jpg',
			'member',
		)
	})

	test('serves video-compatible byte ranges from the authorized descriptor', async () => {
		const response = await got(`${origin}/api/photos/live/member-item`, {
			headers: {Authorization: 'Bearer member', Range: 'bytes=1-3'},
		})
		expect(response.statusCode).toBe(206)
		expect(response.headers['content-range']).toBe('bytes 1-3/11')
		expect(response.body).toBe('emb')
	})

	test('serves Insta360 originals as MP4-family video', async () => {
		const response = await got(`${origin}/api/photos/original/member-video`, {
			headers: {Authorization: 'Bearer member'},
		})
		expect(response.headers['content-type']).toBe('video/mp4')
		expect(response.body).toBe('member-360-video')
	})

	test('a member cannot combine its item with an owner item in one download', async () => {
		const response = await got(`${origin}/api/photos/download?ticket=mixed-download`, {
			headers: {Authorization: 'Bearer member'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(404)
	})

	test('streams an upload through BLAKE3 and waits for the account-scoped import verdict', async () => {
		const response = await got(`${origin}/api/photos/upload?name=upload.jpg&album=album`, {
			method: 'POST',
			headers: {Authorization: 'Bearer member'},
			body: 'uploaded bytes',
		})
		expect(JSON.parse(response.body)).toStrictEqual({status: 'duplicate'})
		expect(prepareUpload).toHaveBeenCalledWith('member', expect.objectContaining({length: 32}), 'album')
		expect(registerUpload).not.toHaveBeenCalled()
		await expect(stat(nodePath.join(directory, 'member-home', 'Photos', 'upload.jpg'))).rejects.toThrow()
	})

	test('publishes and registers a non-duplicate upload', async () => {
		prepareUpload.mockResolvedValueOnce('new')
		const response = await got(`${origin}/api/photos/upload?name=import.jpg&album=album`, {
			method: 'POST',
			headers: {Authorization: 'Bearer member'},
			body: 'imported bytes',
		})
		expect(JSON.parse(response.body)).toStrictEqual({status: 'imported'})
		expect(registerUpload).toHaveBeenCalledWith(
			'member',
			nodePath.join(directory, 'member-home', 'Photos', 'import.jpg'),
			expect.objectContaining({length: 32}),
			expect.objectContaining({
				inode: expect.any(String),
				size: 14,
				modifiedNs: expect.any(String),
				ctimeNs: expect.any(String),
			}),
			'album',
			undefined,
		)
	})

	test.each([946684800000, 0, -315619200000, -62135596800000, 253402300799999])(
		'passes a valid browser modification date to registration: %s',
		async (lastModified) => {
			prepareUpload.mockResolvedValueOnce('new')
			const response = await got(
				`${origin}/api/photos/upload?name=date-${lastModified}.jpg&lastModified=${lastModified}`,
				{
					method: 'POST',
					headers: {Authorization: 'Bearer member'},
					body: 'dated bytes',
				},
			)
			expect(response.statusCode).toBe(200)
			expect(registerUpload.mock.calls[0]?.slice(4)).toEqual([undefined, lastModified])
		},
	)

	test.each([
		'',
		'NaN',
		'Infinity',
		'1.5',
		'1e3',
		'253402300800000',
		'-62135596800001',
		'0&lastModified=1',
		'0&lastModified[x]=1',
	])('rejects an invalid browser modification date before importing: %s', async (lastModified) => {
		const response = await got(`${origin}/api/photos/upload?name=invalid.jpg&lastModified=${lastModified}`, {
			method: 'POST',
			headers: {Authorization: 'Bearer member'},
			body: 'invalid date',
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(400)
		expect(prepareUpload).not.toHaveBeenCalled()
		expect(registerUpload).not.toHaveBeenCalled()
	})

	test('rejects unsupported uploads before consuming them', async () => {
		const response = await got(`${origin}/api/photos/upload?name=notes.txt`, {
			method: 'POST',
			headers: {Authorization: 'Bearer member'},
			body: 'not media',
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(415)
	})

	test('preserves published bytes for index recovery when durable Photos registration fails', async () => {
		prepareUpload.mockResolvedValueOnce('new')
		registerUpload.mockRejectedValueOnce(new Error('injected registration failure'))
		const response = await got(`${origin}/api/photos/upload?name=rollback.jpg&album=album`, {
			method: 'POST',
			headers: {Authorization: 'Bearer member'},
			body: 'rollback bytes',
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(500)
		await expect(stat(nodePath.join(directory, 'member-home', 'Photos', 'rollback.jpg'))).resolves.toMatchObject({
			size: 14,
		})
	})
})
