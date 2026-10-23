import {once} from 'node:events'
import {mkdtemp, open, rm, stat, writeFile} from 'node:fs/promises'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'
import {gzipSync} from 'node:zlib'

import cookieParser from 'cookie-parser'
import express from 'express'
import got from 'got'
import {afterAll, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import UploadDiskPreflight from '../server/upload-disk-preflight.ts'
import photosApi from './api.ts'

describe('Photos HTTP account boundaries', () => {
	let server: ReturnType<express.Express['listen']>
	let origin: string
	let directory: string
	const resolveThumbnailRequest = vi.fn()
	const prepareUpload = vi.fn()
	const registerUpload = vi.fn()
	const mapPoints = vi.fn()
	const mapTile = vi.fn()

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
				mapPoints,
				map: {tile: mapTile},
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
		mapPoints.mockReset().mockResolvedValue(new Uint8Array([1, 0, 0, 0]))
		mapTile.mockReset()
	})

	test.each([
		['GET', '/api/photos/thumb/member-item?s=192'],
		['GET', '/api/photos/original/member-item'],
		['GET', '/api/photos/live/member-item'],
		['GET', '/api/photos/download?ticket=member-download'],
		['POST', '/api/photos/upload?name=photo.jpg'],
		['GET', '/api/photos/map/points'],
		['GET', '/api/photos/map/tiles/0/0/0'],
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

	test('map points are read for the requesting account, with its filter, and revalidate by ETag', async () => {
		const filter = {favorite: true, bounds: {west: 170, south: -20, east: -170, north: -10}}
		const url = `${origin}/api/photos/map/points?filter=${encodeURIComponent(JSON.stringify(filter))}`
		const headers = {Authorization: 'Bearer member'}
		const response = await got(url, {headers, responseType: 'buffer'})
		expect([...response.body]).toEqual([1, 0, 0, 0])
		expect(mapPoints).toHaveBeenCalledWith('member', filter)
		expect(response.headers['cache-control']).toBe('private, no-cache')
		const unchanged = await got(url, {headers: {...headers, 'If-None-Match': response.headers.etag}})
		expect(unchanged.statusCode).toBe(304)
		await got(`${origin}/api/photos/map/points`, {headers})
		expect(mapPoints).toHaveBeenLastCalledWith('member', {})
	})

	test.each([
		['not json', 'filter=%7B'],
		['a field of the wrong type', `filter=${encodeURIComponent('{"favorite":"yes"}')}`],
		['bounds off the map', `filter=${encodeURIComponent('{"bounds":{"west":-200,"south":0,"east":0,"north":10}}')}`],
	])('map points reject a filter that is %s', async (_, query) => {
		const response = await got(`${origin}/api/photos/map/points?${query}`, {
			headers: {Authorization: 'Bearer member'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(400)
		expect(mapPoints).not.toHaveBeenCalled()
	})

	test('a basemap tile goes out gzipped, kept by the browser for good under the build it is of', async () => {
		const headers = {Authorization: 'Bearer member'}
		mapTile.mockResolvedValue({build: 'planet-1', data: gzipSync('tile')})
		const tile = await got(`${origin}/api/photos/map/tiles/3/4/5?build=planet-1`, {headers})
		expect(mapTile).toHaveBeenCalledWith(3, 4, 5)
		// got undoes the encoding the response declares, as a browser does
		expect(tile.body).toBe('tile')
		expect(tile.headers['content-encoding']).toBe('gzip')
		expect(tile.headers['content-type']).toBe('application/x-protobuf')
		expect(tile.headers['cache-control']).toBe('private, max-age=31536000, immutable')

		// Asked for under a build that has gone, or none, it is the current one's, kept no longer
		for (const query of ['?build=planet-0', '']) {
			const stale = await got(`${origin}/api/photos/map/tiles/3/4/5${query}`, {headers})
			expect(stale.body).toBe('tile')
			expect(stale.headers['cache-control']).toBe('private, no-cache')
		}
	})

	test('a tile the build lacks is empty, kept like one it has, and a failed fetch is not kept at all', async () => {
		const headers = {Authorization: 'Bearer member'}
		mapTile.mockResolvedValue({build: 'planet-1', data: undefined})
		const missing = await got(`${origin}/api/photos/map/tiles/9/0/0?build=planet-1`, {headers})
		expect(missing.statusCode).toBe(204)
		expect(missing.headers['cache-control']).toBe('private, max-age=31536000, immutable')

		mapTile.mockRejectedValue(new Error('out of reach'))
		const failed = await got(`${origin}/api/photos/map/tiles/0/0/0?build=planet-1`, {
			headers,
			throwHttpErrors: false,
		})
		expect(failed.statusCode).toBe(404)
		expect(failed.headers['cache-control']).toBe('no-store')
	})

	test.each(['a/0/0', '0/-1/0', '0/0/1.5', '2/4/0', '30/0/0'])('a basemap tile at %s is refused', async (tile) => {
		const response = await got(`${origin}/api/photos/map/tiles/${tile}`, {
			headers: {Authorization: 'Bearer member'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(400)
		expect(mapTile).not.toHaveBeenCalled()
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
		)
	})

	test("stores the browser's last-modified time before the upload is published and registered", async () => {
		prepareUpload.mockResolvedValue('new')
		const lastModified = Date.UTC(2015, 5, 1)
		for (const name of ['dated.jpg', 'dated (2).jpg']) {
			// The second upload of the same name is kept beside the first.
			const response = await got(`${origin}/api/photos/upload?name=dated.jpg&lastModified=${lastModified}`, {
				method: 'POST',
				headers: {Authorization: 'Bearer member'},
				body: `bytes of ${name}`,
			})
			expect(JSON.parse(response.body)).toStrictEqual({status: 'imported'})
			const stats = await stat(nodePath.join(directory, 'member-home', 'Photos', name), {bigint: true})
			expect(Number(stats.mtimeMs)).toBe(lastModified)
			// The registered revision already describes the final file.
			expect(registerUpload).toHaveBeenLastCalledWith(
				'member',
				nodePath.join(directory, 'member-home', 'Photos', name),
				expect.objectContaining({length: 32}),
				expect.objectContaining({modifiedNs: stats.mtimeNs.toString(), ctimeNs: stats.ctimeNs.toString()}),
				undefined,
			)
		}
	})

	test('an upload without a last-modified time keeps the time it was written', async () => {
		prepareUpload.mockResolvedValueOnce('new')
		const before = Date.now()
		await got(`${origin}/api/photos/upload?name=undated.jpg`, {
			method: 'POST',
			headers: {Authorization: 'Bearer member'},
			body: 'undated bytes',
		})
		const stats = await stat(nodePath.join(directory, 'member-home', 'Photos', 'undated.jpg'))
		expect(stats.mtimeMs).toBeGreaterThanOrEqual(before - 1000)
	})

	test.each([
		['', 'empty'],
		['abc', 'not a number'],
		['1.5', 'fractional'],
		['1e3', 'exponent'],
		['0', 'unset'],
		['-86400000', 'before the epoch'],
		['253402300800000', 'after the supported range'],
		['9007199254740993', 'unsafe integer'],
		['1&lastModified=2', 'repeated'],
	])('rejects an invalid last-modified time before consuming the upload: %s (%s)', async (lastModified) => {
		const response = await got(`${origin}/api/photos/upload?name=invalid.jpg&lastModified=${lastModified}`, {
			method: 'POST',
			headers: {Authorization: 'Bearer member'},
			body: 'invalid bytes',
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(400)
		expect(prepareUpload).not.toHaveBeenCalled()
		await expect(stat(nodePath.join(directory, 'member-home', 'Photos', 'invalid.jpg'))).rejects.toThrow()
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
