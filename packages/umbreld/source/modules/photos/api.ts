// Photos HTTP endpoints. The client derives every URL from content-hash item ids
// (API responses carry no media URL fields):
//
//   GET  /api/photos/thumb/:id?s=192|512|1280
//   GET  /api/photos/original/:id[?download]
//   GET  /api/photos/live/:id
//   GET  /api/photos/download?ticket=…
//   POST /api/photos/upload?name=IMG_1234.jpg&album=<id>&lastModified=<ms> (browser import)
//   POST /api/photos/upload + X-Umbrel-Photo-Backup-* headers (PhotoKit backup;
//        optional X-Umbrel-Photo-Cloud-Identifier-Base64 + X-Umbrel-Photo-Resource-Role)
//   POST /api/photos/claim {resources} (PhotoKit backup; marks files its backup
//        already has as backed up instead of uploading them)
//   GET  /api/photos/map/points?filter=…
//   GET  /api/photos/map/tiles/:z/:x/:y
//
import nodePath from 'node:path'
import {pipeline} from 'node:stream/promises'

import express from 'express'

import type Umbreld from '../../index.ts'
import type {Principal} from '../auth/auth.ts'
import {authorizeDashboardRequest, authorizeHttpRequest, authorizePhotoBackupRequest} from '../auth/http-request.ts'
import {receiveUpload, uploadLastModified} from '../files/api.ts'
import {lookupMimeType} from '../files/mime.ts'
import type UploadDiskPreflight from '../server/upload-disk-preflight.ts'
import {PRIVATE_IMMUTABLE_CACHE_CONTROL} from '../server/cache-control.ts'
import type {ThumbnailVariant} from '../files/thumbnail-support.ts'
import {OWNER_USER_ID} from '../user/constants.ts'

import {
	PHOTO_CLOUD_IDENTIFIER_MAX_BYTES,
	PHOTO_FILE_EXTENSION_PATTERN,
	PHOTO_ORIGINAL_FILENAME_MAX_BYTES,
	PHOTO_RESOURCE_KEY_PATTERN,
	PHOTO_RESOURCE_ROLE_PATTERN,
} from './photos.ts'
import {backupResourceClaimsInput, filterSchema} from './routes.ts'
import {supportsPhotos} from './types.ts'

// A build of the basemap never changes, so a tile asked for under the build
// it is of is the browser's to keep for good. One asked for under another
// (a map drawn before a new build came) is this build's, kept no longer than
// it takes to draw.
const MAP_KEPT = 'private, max-age=31536000, immutable'
const MAP_NOT_KEPT = 'private, no-cache'

const INSUFFICIENT_STORAGE_HEADER = 'X-Umbrel-Photo-Backup-Error'
const MIN_PHOTO_CREATION_DATE = -62_135_596_800_000
const MAX_PHOTO_CREATION_DATE = 253_402_300_799_999

type PhotoBackupPrincipal = Awaited<ReturnType<Umbreld['auth']['authenticatePhotoBackupGrant']>>

function sendMapFile(response: express.Response, data: Buffer) {
	response.setHeader('Content-Encoding', 'gzip')
	response.type('application/x-protobuf')
	return response.send(data)
}

function isInsufficientStorageError(error: unknown) {
	const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
	return code === 'ENOSPC' || code === 'EDQUOT'
}

class InactivePhotoBackupSourceError extends Error {}

function decodeHeaderText(encoded: string | undefined, maxBytes: number) {
	if (!encoded) return
	const bytes = Buffer.from(encoded, 'base64')
	if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString('base64') !== encoded) return
	const text = bytes.toString('utf8')
	if (!Buffer.from(text, 'utf8').equals(bytes) || /[\u0000-\u001f\u007f]/.test(text)) return
	return text
}

function decodeOriginalFilename(encoded: string | undefined) {
	return decodeHeaderText(encoded, PHOTO_ORIGINAL_FILENAME_MAX_BYTES)
}

// Newer clients name the PhotoKit asset a resource came from: its
// PHCloudIdentifier archival string and the resource's role within the asset.
// Both or neither; older clients send neither.
function decodeCloudIdentity(request: express.Request) {
	const encoded = request.get('X-Umbrel-Photo-Cloud-Identifier-Base64')
	const role = request.get('X-Umbrel-Photo-Resource-Role')
	if (encoded === undefined && role === undefined) return {}
	const cloudIdentifier = decodeHeaderText(encoded, PHOTO_CLOUD_IDENTIFIER_MAX_BYTES)
	if (!cloudIdentifier || !role || !PHOTO_RESOURCE_ROLE_PATTERN.test(role)) return {invalid: true as const}
	return {cloud: {cloudIdentifier, role}}
}

async function receivePhotoBackupUpload(
	umbreld: Umbreld,
	uploadDiskPreflight: UploadDiskPreflight,
	request: express.Request,
	response: express.Response,
) {
	const resourceKey = request.get('X-Umbrel-Photo-Backup-Key')
	const fileExtension = request.get('X-Umbrel-Photo-Backup-Extension')?.toLowerCase()
	const originalFilename = decodeOriginalFilename(request.get('X-Umbrel-Photo-Original-Filename-Base64'))
	const rawSourceCreationDate = request.get('X-Umbrel-Photo-Creation-Date-Ms')
	const sourceCreationDate = rawSourceCreationDate === undefined ? undefined : Number(rawSourceCreationDate)
	const rawContentLength = request.get('Content-Length')
	const contentLength = Number(rawContentLength)
	const {cloud, invalid: invalidCloudIdentity} = decodeCloudIdentity(request)
	if (
		invalidCloudIdentity ||
		!resourceKey ||
		!PHOTO_RESOURCE_KEY_PATTERN.test(resourceKey) ||
		!originalFilename ||
		!fileExtension ||
		!PHOTO_FILE_EXTENSION_PATTERN.test(fileExtension) ||
		(rawSourceCreationDate !== undefined &&
			(!/^-?\d+$/.test(rawSourceCreationDate) ||
				!Number.isSafeInteger(sourceCreationDate) ||
				sourceCreationDate! < MIN_PHOTO_CREATION_DATE ||
				sourceCreationDate! > MAX_PHOTO_CREATION_DATE)) ||
		!rawContentLength ||
		!/^\d+$/.test(rawContentLength) ||
		!Number.isSafeInteger(contentLength) ||
		contentLength <= 0
	) {
		response.setHeader('Connection', 'close')
		return response.status(400).json({error: 'invalid photo backup request'})
	}
	const principal = response.locals.photoBackupPrincipal as PhotoBackupPrincipal
	const stagedSource = await umbreld.photos.getBackupSource(principal.accountId, principal.sourceId)
	if (!stagedSource) {
		response.setHeader('Connection', 'close')
		return response.status(401).json({error: 'unauthorized'})
	}
	let receipt: {resourceKey: string; path: string; bytes: number} | undefined
	let matchingResource:
		| {
				receipt: {resourceKey: string; path: string; bytes: number}
				revision: {inode: string; size: number; modifiedNs: string; ctimeNs: string}
		  }
		| undefined
	let activeSource = stagedSource
	try {
		response.locals.principal = principal
		const virtualPath = await umbreld.photos.prepareBackupResourcePath(stagedSource, resourceKey, fileExtension)
		const upload = await receiveUpload(umbreld, uploadDiskPreflight, request, response, {
			virtualPath,
			// A resource-key pathname is user-accessible ordinary Home storage. Never
			// overwrite bytes that may have been edited independently; exact retries
			// are recognized below, and changed resources publish with keep-both.
			collision: 'keep-both',
			calculateBlake3: true,
			insufficientStorageHeader: {name: INSUFFICIENT_STORAGE_HEADER, value: 'insufficient-storage'},
			onBeforePublish: async () => {
				if (!matchingResource) return 'publish'
				if (
					!(await umbreld.photos.backupResourceRevisionIsCurrent(
						principal.accountId,
						matchingResource.receipt.path,
						matchingResource.revision,
					))
				) {
					matchingResource = undefined
					return 'publish'
				}
				receipt = matchingResource.receipt
				return 'skip'
			},
			publicationGuard: async (publish, staged) => {
				const result = await umbreld.photos.withBackupSource(
					principal.accountId,
					principal.sourceId,
					async (source) => {
						// A request authenticated before removal must not attach itself to a
						// later source lifecycle that happens to reuse the same source id.
						if (source.createdAt !== stagedSource.createdAt) throw new InactivePhotoBackupSourceError()
						activeSource = source
						// An exact retry of this resource first, then the same bytes
						// already in this source. Either one is answered without a second copy.
						matchingResource = staged.blake3
							? ((await umbreld.photos.registerMatchingBackupResource(
									source,
									resourceKey,
									virtualPath,
									staged.blake3,
									originalFilename,
									sourceCreationDate,
									cloud,
								)) ??
								(await umbreld.photos.registerSourceDuplicateBackupResource(
									source,
									resourceKey,
									staged.blake3,
									originalFilename,
									sourceCreationDate,
									cloud,
								)))
							: undefined
						return publish()
					},
				)
				if (!result.active) throw new InactivePhotoBackupSourceError()
				return result.value
			},
			onPublished: async (published) => {
				if (!published.blake3) throw new Error('Missing photo backup hash')
				receipt = await umbreld.photos.registerBackupResource(
					activeSource,
					resourceKey,
					published.systemPath,
					published.blake3,
					published.revision,
					originalFilename,
					sourceCreationDate,
					cloud,
				)
			},
		})
		if (!upload) return
		if (!receipt) throw new Error('Photo backup registration did not complete')
		response.setHeader('Cache-Control', 'no-store')
		response.setHeader('X-Umbrel-Photo-Backup-Key', resourceKey)
		response.setHeader('X-Umbrel-Upload-Bytes', String(receipt.bytes))
		await umbreld.auth
			.touchSession(principal)
			.catch((error) => umbreld.logger.error('Failed to update photo backup session activity', error))
		return response.status(200).json({resourceKey, bytes: receipt.bytes})
	} catch (error) {
		if (!response.headersSent) {
			if (error instanceof InactivePhotoBackupSourceError) {
				response.setHeader('Connection', 'close')
				return response.status(401).json({error: 'unauthorized'})
			}
			if (isInsufficientStorageError(error)) {
				response.setHeader(INSUFFICIENT_STORAGE_HEADER, 'insufficient-storage')
				return response.status(507).json({error: '[not-enough-space]'})
			}
			response.setHeader('Connection', 'close')
			return response.status(500).json({error: 'error writing photo backup'})
		}
	}
}

const THUMB_VARIANTS: Record<string, ThumbnailVariant> = {
	'192': 'preview-192-webp-v1',
	'512': 'preview-512-webp-v2',
	'1280': 'preview-1280-webp-v2',
}

function accountId(response: express.Response) {
	const principal = response.locals.principal as Principal | undefined
	if (!principal) throw new Error('Missing authenticated principal')
	return principal.accountId
}

function uploadDirectoryForAccount(id: string) {
	return id === OWNER_USER_ID ? '/Home/Photos' : `/Users/${id}/Photos`
}

function requestedByteRange(header: string | undefined, size: number) {
	if (!header) return {start: 0, end: Math.max(0, size - 1), partial: false} as const
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
	if (!match || size === 0) return
	const [, startText, endText] = match
	if (!startText && !endText) return
	let start: number
	let end: number
	if (!startText) {
		const suffixLength = Number(endText)
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return
		start = Math.max(0, size - suffixLength)
		end = size - 1
	} else {
		start = Number(startText)
		end = endText ? Number(endText) : size - 1
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return
		end = Math.min(end, size - 1)
	}
	return {start, end, partial: true} as const
}

export default function api(umbreld: Umbreld, uploadDiskPreflight: UploadDiskPreflight) {
	const api = express.Router()

	// Deny-by-default, like Files' router: adding a handler below also requires
	// an explicit policy here. Media GETs use URL-token authorization; browser
	// imports use the dashboard session, while PhotoKit uses a source-bound grant.
	api.use((request, response, next) => {
		const path = request.path.replace(/\/+$/, '') || '/'
		if (request.method === 'OPTIONS' && path === '/upload') return next()
		const isBackupUpload = path === '/upload' && request.get('X-Umbrel-Photo-Backup-Key')
		if (request.method === 'POST' && (isBackupUpload || path === '/claim')) {
			return authorizePhotoBackupRequest(umbreld, request)
				.then((principal) => {
					response.locals.photoBackupPrincipal = principal
					next()
				})
				.catch(() => response.status(401).json({error: 'unauthorized'}))
		}
		let authorization: Promise<Principal> | undefined
		if (request.method === 'GET' && (path.startsWith('/thumb/') || path.startsWith('/map/'))) {
			authorization = authorizeHttpRequest(umbreld, request, 'file-thumbnail', path)
		} else if (request.method === 'GET' && (path.startsWith('/original/') || path.startsWith('/live/'))) {
			authorization = authorizeHttpRequest(umbreld, request, 'file-view', path)
		} else if (request.method === 'GET' && path === '/download') {
			authorization = authorizeHttpRequest(umbreld, request, 'file-download', path)
		} else if (request.method === 'POST' && path === '/upload') {
			authorization = authorizeDashboardRequest(umbreld, request)
		}
		if (!authorization) return response.status(401).json({error: 'unauthorized'})
		authorization
			.then((principal) => {
				response.locals.principal = principal
				next()
			})
			.catch(() => response.status(401).json({error: 'unauthorized'}))
	})

	// A phone asks which files its backup already has before it uploads them: ones
	// it sent before the app was installed again, or ones the phone it was restored
	// from sent. The answer names the files it doesn't need to send.
	const parseClaimBody = express.json({limit: '1mb'})
	api.post('/claim', async (request, response) => {
		const principal = response.locals.photoBackupPrincipal as PhotoBackupPrincipal
		// Before the body arrives, as for an upload, so a request authenticated before
		// removal can't claim into a later source that reuses the same id
		const stagedSource = await umbreld.photos.getBackupSource(principal.accountId, principal.sourceId)
		if (!stagedSource) {
			response.setHeader('Connection', 'close')
			return response.status(401).json({error: 'unauthorized'})
		}
		const bodyError = await new Promise<{type?: string} | undefined>((resolve) =>
			parseClaimBody(request, response, resolve),
		)
		if (bodyError) {
			const status = bodyError.type === 'entity.too.large' ? 413 : 400
			return response.status(status).json({error: 'invalid photo backup request'})
		}
		const input = backupResourceClaimsInput.safeParse(request.body)
		if (!input.success) return response.status(400).json({error: 'invalid photo backup request'})
		try {
			const receipts = await umbreld.photos.claimBackupResources({
				accountId: principal.accountId,
				sourceId: principal.sourceId,
				createdAt: stagedSource.createdAt,
				resources: input.data.resources,
			})
			if (!receipts) return response.status(401).json({error: 'unauthorized'})
			return response.json(receipts)
		} catch (error) {
			umbreld.logger.error('Failed to claim photo backup resources', error)
			return response.status(500).json({error: 'claim failed'})
		}
	})

	// Apple probes for a resumable upload protocol before falling back to the
	// ordinary request body used by the native backup extension.
	api.options('/upload', (_request, response) => response.sendStatus(501))

	// Resolve the account-scoped content hash, then re-authorize the current
	// virtual path at the Files boundary before touching the original.
	async function resolveItemId(id: string, response: express.Response) {
		const item = await umbreld.photos.resolveItem(accountId(response), id)
		if (!item) throw new Error('[photos-item-not-found]')
		return {virtualPath: item.path, modifiedMs: item.modifiedMs}
	}

	function resolveItem(request: express.Request, response: express.Response) {
		return resolveItemId(String(request.params.id), response)
	}

	async function streamAuthorizedFile(
		virtualPath: string,
		request: express.Request,
		response: express.Response,
		{download = false, contentAddressed = false}: {download?: boolean; contentAddressed?: boolean} = {},
	) {
		const file = await umbreld.files.openFileForRead(virtualPath, accountId(response))
		try {
			const size = Number(file.stats.size)
			const range = requestedByteRange(request.get('Range'), size)
			if (!range) {
				response.setHeader('Content-Range', `bytes */${size}`)
				return response.status(416).end()
			}
			if (contentAddressed) response.setHeader('Cache-Control', PRIVATE_IMMUTABLE_CACHE_CONTROL)
			response.setHeader('Accept-Ranges', 'bytes')
			response.setHeader('Content-Length', String(size === 0 ? 0 : range.end - range.start + 1))
			response.setHeader('Last-Modified', new Date(Number(file.stats.mtimeMs)).toUTCString())
			if (download) {
				response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
				response.setHeader('Content-Type', 'application/octet-stream')
			} else {
				response.setHeader('Content-Type', lookupMimeType(file.name) || 'application/octet-stream')
			}
			if (range.partial) {
				response.status(206)
				response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
			}
			if (size === 0) return response.end()
			await pipeline(file.handle.createReadStream({autoClose: false, start: range.start, end: range.end}), response)
		} finally {
			await file.handle.close().catch(() => {})
		}
	}

	// GET /api/photos/thumb/:id?s=192|512|1280 — content-addressed renditions,
	// generated in the background or promoted through the on-demand lane.
	api.get('/thumb/:id', async (request, response) => {
		try {
			const s = String(request.query.s ?? '')
			const variant = THUMB_VARIANTS[s]
			if (!variant) return response.status(400).json({error: 'invalid s parameter'})
			const {virtualPath} = await resolveItem(request, response)
			const thumbnailUrl = await umbreld.files.thumbnails.getThumbnailOnDemand(
				virtualPath,
				accountId(response),
				variant,
			)
			const filename = nodePath.posix.basename(new URL(thumbnailUrl, 'http://localhost').pathname)
			const thumbnailSystemPath = await umbreld.files.thumbnails.resolveThumbnailRequest(
				filename,
				virtualPath,
				accountId(response),
			)
			response.setHeader('Cache-Control', PRIVATE_IMMUTABLE_CACHE_CONTROL)
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return response.sendFile(thumbnailSystemPath, {cacheControl: false, dotfiles: 'deny'})
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	// GET /api/photos/map/points?filter=<json> — every located item the filter
	// selects, packed (see MAP_POINT_BYTES in types.ts). Revalidated by ETag,
	// which saves the transfer when no pin moved; the read itself always runs.
	api.get('/map/points', async (request, response) => {
		let filter
		try {
			filter = filterSchema.parse(JSON.parse(String(request.query.filter ?? '{}')))
		} catch {
			return response.status(400).json({error: 'invalid filter'})
		}
		try {
			const points = await umbreld.photos.mapPoints(accountId(response), filter)
			response.setHeader('Cache-Control', 'private, no-cache')
			response.type('application/octet-stream')
			return response.send(Buffer.from(points.buffer, points.byteOffset, points.byteLength))
		} catch {
			return response.status(500).json({error: 'map points unavailable'})
		}
	})

	// GET /api/photos/map/tiles/:z/:x/:y?build=<build> — a basemap vector tile
	// (see map-tiles.ts), gzipped; 204 where the build has none, which the map
	// draws as nothing rather than an error. Both are kept by the browser for
	// good under the build they are of (`photos.map.basemap`'s); a failure
	// isn't, as the source may only have been out of reach.
	api.get('/map/tiles/:z/:x/:y', async (request, response) => {
		const [z, x, y] = [request.params.z, request.params.x, request.params.y].map(Number) as [number, number, number]
		const onTheMap =
			[z, x, y].every((value) => Number.isInteger(value) && value >= 0) && z <= 26 && x < 2 ** z && y < 2 ** z
		if (!onTheMap) return response.status(400).json({error: 'invalid tile'})
		try {
			const {build, data} = await umbreld.photos.map.tile(z, x, y)
			response.setHeader('Cache-Control', request.query.build === build ? MAP_KEPT : MAP_NOT_KEPT)
			if (!data) return response.status(204).end()
			return sendMapFile(response, data)
		} catch {
			response.setHeader('Cache-Control', 'no-store')
			return response.status(404).json({error: 'not found'})
		}
	})

	// GET /api/photos/original/:id — content-addressed original bytes, including video ranges.
	// `?download` switches to attachment disposition.
	api.get('/original/:id', async (request, response) => {
		try {
			const {virtualPath} = await resolveItem(request, response)
			response.setHeader('X-Content-Type-Options', 'nosniff')
			response.setHeader(
				'Content-Security-Policy',
				"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
			)
			return await streamAuthorizedFile(virtualPath, request, response, {
				download: request.query.download !== undefined,
				contentAddressed: true,
			})
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	// GET /api/photos/live/:id — the motion companion for an indexed Apple
	// live pair. The companion path is independently re-authorized. The still id
	// does not content-address the motion bytes, so this URL is not immutable.
	api.get('/live/:id', async (request, response) => {
		try {
			const companion = await umbreld.photos.resolveLiveCompanion(accountId(response), String(request.params.id))
			if (!companion) throw new Error('[photos-live-not-found]')
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return await streamAuthorizedFile(companion.path, request, response)
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	// GET /api/photos/download?ticket=… — the ticket contains one or more
	// account-bound item ids and is short-lived and single-use. One item is sent
	// as an attachment; several become a flat zip stream. Each id is translated
	// to a currently-authorized filesystem path at request time, and duplicate
	// basenames are disambiguated in the archive.
	api.get('/download', async (request, response) => {
		try {
			if (typeof request.query.ticket !== 'string') return response.status(400).json({error: 'bad request'})
			const ids = umbreld.photos.consumeDownloadTicket(accountId(response), request.query.ticket)
			if (!ids) return response.status(404).json({error: 'not found'})
			const items = await Promise.all(ids.map((id) => resolveItemId(String(id), response)))
			if (items.length === 1) {
				response.setHeader('X-Content-Type-Options', 'nosniff')
				return await streamAuthorizedFile(items[0]!.virtualPath, request, response, {download: true})
			}
			response.setHeader('Content-Type', 'application/zip')
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''umbrel-photos.zip`)
			await pipeline(
				await umbreld.files.archive.createAuthorizedFlatFileZipStream(items, accountId(response)),
				response,
			)
		} catch {
			if (!response.headersSent) response.status(404).json({error: 'not found'})
		}
	})

	// POST /api/photos/upload?name=IMG_1234.jpg&album=a-iceland&lastModified=1433116800000
	// — body = the bytes, one file per request. Bytes land in the current
	// account's Photos directory through Files' hardened upload primitive (temp
	// file, keep-both collisions, ownership). The optional `lastModified` is the
	// browser's File.lastModified and becomes the stored file's modification
	// time, which dates media whose bytes carry no capture date.
	// 2xx answers {status: 'imported' | 'duplicate'}; unsupported types → 415.
	api.post('/upload', async (request, response) => {
		if (response.locals.photoBackupPrincipal) {
			return receivePhotoBackupUpload(umbreld, uploadDiskPreflight, request, response)
		}
		// `Connection: close` on early errors so the browser doesn't stream the
		// whole body before reading the verdict (see Files' uploadFile)
		const name = typeof request.query.name === 'string' ? nodePath.basename(request.query.name) : ''
		const albumId = typeof request.query.album === 'string' ? request.query.album : undefined
		const lastModified = uploadLastModified(request.query.lastModified)
		if (!name) {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'name is required'})
		}
		if (lastModified === 'invalid') {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'invalid lastModified parameter'})
		}
		if (!supportsPhotos(name)) {
			response.setHeader('Connection', 'close')
			return response.status(415).json({error: 'unsupported file type'})
		}
		if (albumId && !(await umbreld.photos.listAlbums(accountId(response))).some(({id}) => id === albumId)) {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: '[photos-album-not-found]'})
		}
		try {
			const id = accountId(response)
			let importStatus: 'imported' | 'duplicate' | undefined
			const upload = await receiveUpload(umbreld, uploadDiskPreflight, request, response, {
				virtualPath: `${uploadDirectoryForAccount(id)}/${name}`,
				collision: 'keep-both',
				calculateBlake3: true,
				modifiedMs: lastModified,
				onBeforePublish: async (blake3) => {
					const status = await umbreld.photos.prepareUpload(id, blake3, albumId)
					if (status === 'duplicate') {
						importStatus = status
						return 'skip'
					}
					return 'publish'
				},
				onPublished: async (published) => {
					if (!published.blake3) throw new Error('Missing upload hash')
					importStatus = await umbreld.photos.registerUpload(
						id,
						published.systemPath,
						published.blake3,
						published.revision,
						albumId,
					)
				},
			})
			if (!upload) return
			if (!importStatus) throw new Error('Photos import did not complete')
			return response.status(200).json({status: importStatus})
		} catch {
			// receiveUpload answers byte-transfer errors; this guards import
			// bookkeeping (for example, an album deleted mid-upload). Once bytes
			// are published they remain filesystem-authoritative so index recovery
			// can discover them without a pathname-based rollback race.
			if (!response.headersSent) response.status(500).json({error: 'upload failed'})
		}
	})

	return api
}
