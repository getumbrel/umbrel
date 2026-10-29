import {randomBytes} from 'node:crypto'
import {constants, type BigIntStats} from 'node:fs'
import {copyFile, link, lstat, open, unlink} from 'node:fs/promises'
import nodePath from 'node:path'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import express from 'express'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import type Umbreld from '../../index.ts'
import type {Principal} from '../auth/auth.ts'
import {authorizeDashboardRequest, authorizeHttpRequest} from '../auth/http-request.ts'
import type UploadDiskPreflight from '../server/upload-disk-preflight.ts'
import {PRIVATE_IMMUTABLE_CACHE_CONTROL} from '../server/cache-control.ts'
import {Blake3Hasher} from './blake3.ts'
import type {PublishedFileRevision} from './file-index-enrichment.ts'
import {lookupMimeType} from './mime.ts'

// Final publication must choose and claim a keep-both name atomically. Umbreld
// has one upload API process, so this also avoids two concurrent requests
// racing through the same existence check before either rename lands.
const uploadPublicationQueue = new PQueue({concurrency: 1})
const HARD_LINK_UNSUPPORTED_ERRORS = new Set(['EACCES', 'EINVAL', 'EMLINK', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'])

// Only allow file types that are safe to preview inline from a same-origin user-controlled endpoint.
const inlineViewMimeTypes = new Set([
	'text/plain',
	'application/pdf',
	'image/avif',
	'image/bmp',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/vnd.microsoft.icon',
	'image/webp',
	'audio/aac',
	'audio/aacp',
	'audio/flac',
	'audio/mp4',
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
	'audio/webm',
	'audio/x-caf',
	'audio/x-flac',
	'audio/x-m4a',
	'audio/x-wav',
	'video/mp4',
	'video/mpeg',
	'video/ogg',
	'video/quicktime',
	'video/webm',
	'video/x-m4v',
])

const embedOnlyInlineViewMimeTypes = new Set([
	// SVG is safe to render as an image, but unsafe as a same-origin document.
	'image/svg+xml',
])

function acceptsEmbeddedSvg(request: express.Request) {
	const fetchDest = request.get('Sec-Fetch-Dest')
	if (fetchDest) return fetchDest === 'image'

	const acceptHeader = request.get('Accept') ?? ''
	const acceptedMimeTypes = acceptHeader
		.split(',')
		.map((type) => type.split(';')[0]?.trim().toLowerCase())
		.filter(Boolean)
	const explicitlyAcceptsSvg = acceptedMimeTypes.includes('image/svg+xml') || acceptedMimeTypes.includes('image/*')
	const acceptsDocument = acceptedMimeTypes.includes('text/html') || acceptedMimeTypes.includes('application/xhtml+xml')

	return explicitlyAcceptsSvg && !acceptsDocument
}

// Identifies the bytes at a path: atomic saves publish a new inode, and
// in-place writes move the size, the modification time or the change time.
// Uploads may set the modification time (lastModified), so a same-size
// rewrite stamped with the old time keeps its inode and mtime; the change
// time is the one no client can set.
export function fileRevision(stats: BigIntStats) {
	return `${stats.ino}-${stats.size}-${stats.mtimeNs}-${stats.ctimeNs}`
}

// If-Match compares strongly, so a weak tag never matches, and "*" only asks
// for an existing file. Only a regular file has a revision to match: replacing
// a symlink would publish over the link, not the file read through it.
export function satisfiesIfMatch(ifMatch: string, destination: BigIntStats | undefined) {
	if (!destination?.isFile()) return false
	const entityTag = `"${fileRevision(destination)}"`
	return ifMatch.trim() === '*' || ifMatch.split(',').some((tag) => tag.trim() === entityTag)
}

export async function publishUploadWithoutReplacing(
	temporarySystemPath: string,
	destinationSystemPath: string,
	{
		createLink = link,
		copyExclusive = (source: string, destination: string) => copyFile(source, destination, constants.COPYFILE_EXCL),
		modifiedMs,
	}: {
		createLink?: typeof link
		copyExclusive?: (source: string, destination: string) => Promise<void>
		modifiedMs?: number
	} = {},
) {
	try {
		await createLink(temporarySystemPath, destinationSystemPath)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (!code || !HARD_LINK_UNSUPPORTED_ERRORS.has(code)) throw error
		let copied = false
		try {
			// COPYFILE_EXCL retains no-clobber semantics on filesystems without
			// hard links (notably exFAT and some network shares).
			await copyExclusive(temporarySystemPath, destinationSystemPath)
			copied = true
			const destination = await open(destinationSystemPath, constants.O_RDONLY | constants.O_NOFOLLOW)
			try {
				// Unlike a hard link, the copy is a new file with its own times.
				if (modifiedMs !== undefined) await destination.utimes(new Date(), new Date(modifiedMs))
				await destination.sync()
			} finally {
				await destination.close()
			}
		} catch (copyError) {
			if (copied) await unlink(destinationSystemPath).catch(() => {})
			throw copyError
		}
	}
	await unlink(temporarySystemPath)
}

function virtualPaths(request: express.Request) {
	if (typeof request.query.path === 'string') return [request.query.path]
	if (Array.isArray(request.query.path)) return request.query.path.map(String)
	return []
}

function accountId(response: express.Response) {
	const principal = response.locals.principal as Principal | undefined
	if (!principal) throw new Error('Missing authenticated principal')
	return principal.accountId
}

function requireFileApiAuth(umbreld: Umbreld) {
	return (request: express.Request, response: express.Response, next: express.NextFunction) => {
		const path = request.path.replace(/\/+$/, '') || '/'
		let authorization: Promise<Principal> | undefined

		// This router is deny-by-default. Adding a handler below also requires an
		// explicit policy here, so a future endpoint cannot accidentally be public.
		if (request.method === 'GET' && (path === '/thumbnail' || path.startsWith('/thumbnail/'))) {
			authorization = authorizeHttpRequest(
				umbreld,
				request,
				'file-thumbnail',
				typeof request.query.path === 'string' ? request.query.path : undefined,
			)
		} else if (request.method === 'GET' && path === '/download') {
			authorization = authorizeHttpRequest(umbreld, request, 'file-download', JSON.stringify(virtualPaths(request)))
		} else if (request.method === 'GET' && path === '/view') {
			authorization = authorizeHttpRequest(
				umbreld,
				request,
				'file-view',
				typeof request.query.path === 'string' ? request.query.path : undefined,
			)
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
	}
}

// Express derives its ETag from size and modification time alone, which
// uploads may now set to the file's original time. A replacement with the same
// size and time would then revalidate as the old file, so the validator also
// covers the inode and change time, which a client cannot set.
async function sendFileRevision(response: express.Response, systemPath: string) {
	const stats = await fse.stat(systemPath, {bigint: true})
	const revision = [stats.size, stats.mtimeNs, stats.ctimeNs, stats.ino].map((value) => value.toString(16))
	response.setHeader('ETag', `W/"${revision.join('-')}"`)
	response.sendFile(systemPath, {dotfiles: 'allow'})
}

export function downloadFiles(umbreld: Umbreld) {
	return async (request: express.Request, response: express.Response) => {
		// Normalise a single path or multiple paths into an array
		const requestedPaths = virtualPaths(request)
		// Check that at least one path is provided
		if (requestedPaths.length < 1) return response.status(400).json({error: 'bad request'})

		// Get file data
		const files = await Promise.all(
			requestedPaths.map(async (path) => {
				try {
					const systemPath = await umbreld.files.virtualToSystemPath(path, accountId(response))
					// This means a file doesn't exist (or can't be safely resolved) so we return a 404
					if (!(await fse.exists(systemPath))) throw new Error('not found')
					return systemPath
				} catch (error) {
					response.status(404).json({error: 'not found'})
					throw error
				}
			}),
		)

		// If we only have a single file, serve it directly
		if (files.length === 1 && (await fse.stat(files[0])).isFile()) {
			const filename = nodePath.basename(files[0])
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
			response.setHeader('Content-Type', 'application/octet-stream')
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return await sendFileRevision(response, files[0])
		}

		// For directory or multiple files, create zip archive
		// Create an archive and stream it to the response
		try {
			const filename = umbreld.files.archive.zipName(files, {defaultName: 'umbrel-files.zip'})
			response.setHeader('Content-Type', 'application/zip')
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
			await pipeline(await umbreld.files.archive.createZipStream(files), response)
		} catch (error) {
			if ((error as Error).message === 'paths must be in same directory') {
				return response.status(400).json({error: (error as Error).message})
			}
			throw error
		}
	}
}

type ReceiveUploadOptions = {
	virtualPath: string
	collision: 'error' | 'keep-both' | 'replace'
	// An If-Match header: replace only the revision the client last read
	ifMatch?: string
	calculateBlake3?: boolean
	// Epoch milliseconds to store as the file's modification time, for callers
	// that know when the uploaded file was last modified on its origin.
	modifiedMs?: number
	insufficientStorageHeader?: {name: string; value: string}
	onBeforePublish?: (hash: Buffer) => Promise<'publish' | 'skip'>
	onPublished?: (upload: PublishedUpload) => Promise<void>
	publicationGuard?: <T>(publish: () => Promise<T>, staged: {blake3?: Buffer}) => Promise<T>
}

export type PublishedUpload = {
	path: string
	systemPath: string
	revision: PublishedFileRevision
	// What HTTP clients see as the revision, see fileRevision()
	fileRevision: string
	blake3?: Buffer
}

type SkippedUpload = {skipped: true}
type RevisionMismatch = {revisionMismatch: true}

export async function receiveUpload(
	umbreld: Umbreld,
	uploadDiskPreflight: UploadDiskPreflight,
	request: express.Request,
	response: express.Response,
	{
		virtualPath,
		collision,
		ifMatch,
		calculateBlake3 = false,
		modifiedMs,
		insufficientStorageHeader,
		onBeforePublish,
		onPublished,
		publicationGuard,
	}: ReceiveUploadOptions,
) {
	// This is shared by Files and Photos so Photos can finish durable import
	// bookkeeping before it sends a success response. Errors are still answered
	// here to retain Files' early Connection: close behavior.

	let requestedSystemPath: string
	let systemPath: string
	try {
		// Check path is valid
		requestedSystemPath = await umbreld.files.virtualToSystemPath(virtualPath, accountId(response))
		systemPath = requestedSystemPath

		// Handle name conflicts
		if (await fse.pathExists(systemPath)) {
			if (collision === 'error') {
				response.setHeader('Connection', 'close')
				response.status(400).json({error: '[destination-already-exists]'})
				return
			} else if (collision === 'keep-both') {
				// For 'keep-both' we generate a unique name for the file
				systemPath = await umbreld.files.getUniqueName(systemPath)
			} else {
				// For 'replace' we simply continue with the upload over the original file
			}
		}

		// Keep-both can move the upload to a sibling outside a narrow share,
		// while replace must not bypass protected-path deletion rules.
		systemPath = await umbreld.files.authorizeWritableDestinationSystemPath(systemPath, accountId(response), {
			replace: collision === 'replace',
		})
	} catch (error) {
		response.setHeader('Connection', 'close')
		// Keep path-resolution and authorization details private, but let the
		// Files client explain why an otherwise accessible Cloud mirror is read-only.
		const safeError = error instanceof Error && error.message === '[cloud-read-only]' ? error.message : 'invalid path'
		response.status(400).json({error: safeError})
		return
	}

	// Refuse a stale revision before reading the body. The file can still change
	// while it streams, so publication checks again.
	if (
		ifMatch !== undefined &&
		!satisfiesIfMatch(ifMatch, await lstat(systemPath, {bigint: true}).catch(() => undefined))
	) {
		response.setHeader('Connection', 'close')
		response.status(412).json({error: '[revision-mismatch]'})
		return
	}

	// TODO: Implement resume support

	// Temporary file to store the uploaded data
	// We do this to avoid ending up with partially uploaded files of the correct name.
	// It's clear that a partially uploaded file with the .umbrel-upload suffix is not a
	// completed upload.
	// It also sets the groundwork for resuming uploads in the future.
	// It also means that fs change events during upload are fired for
	// .somefile.jpg.umbrel-upload not somefile.jpg so we don't trigger loads of
	// thumbnail generation attempts (matching the .jpg suffix) until the file is fully uploaded.
	// Using a dotfile also automatically hides these temporary files from most file listings
	const fileName = nodePath.basename(systemPath)
	const directory = nodePath.dirname(systemPath)
	const temporarySystemPath = nodePath.join(directory, `.${fileName}.${randomBytes(16).toString('hex')}.umbrel-upload`)

	// Reject before writing a byte when the upload can't fit. External and
	// network destinations are separate mounts, while unknown-length requests
	// retain the mid-write failure path. Admission is serialized and reserves
	// each upload exactly once from a stable batch snapshot.
	const contentLength = Number(request.headers['content-length'])
	const destinationVirtualPath = umbreld.files.systemToVirtualPath(systemPath)
	const preflighted =
		umbreld.files.isInternalStorageVirtualPath(destinationVirtualPath) &&
		Number.isFinite(contentLength) &&
		contentLength >= 0
	let admitted = true
	if (preflighted) {
		try {
			admitted = await uploadDiskPreflight.admit(temporarySystemPath, contentLength)
		} catch (error) {
			response.setHeader('Connection', 'close')
			throw error
		}
	}
	if (!admitted) {
		if (insufficientStorageHeader) {
			response.setHeader(insufficientStorageHeader.name, insufficientStorageHeader.value)
		}
		response.status(507).json({error: '[not-enough-space]'})
		return
	}

	let promoted = false
	const hasher = calculateBlake3 ? new Blake3Hasher() : undefined
	try {
		await fse.ensureDir(directory)
		let temporaryFile: Awaited<ReturnType<typeof open>> | undefined
		try {
			// Write the file
			// Never open a predictable path or follow a pre-existing link. Archive
			// extraction can create symlinks, and umbreld writes uploads as root.
			temporaryFile = await open(
				temporarySystemPath,
				constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
				0o600,
			)
			const writeStream = temporaryFile.createWriteStream()
			// The stream owns and closes this descriptor. Reopen the completed
			// temporary file below to make its bytes durable before publication.
			temporaryFile = undefined
			if (hasher) {
				const hashingStream = new Transform({
					transform(chunk: Buffer, _encoding, callback) {
						hasher.update(chunk)
						callback(null, chunk)
					},
				})
				await pipeline(request, hashingStream, writeStream)
			} else {
				await pipeline(request, writeStream)
			}
			const syncHandle = await open(temporarySystemPath, constants.O_RDONLY | constants.O_NOFOLLOW)
			try {
				// Stamp the hidden temporary file, so the published name never
				// exists with another modification time and the revision read
				// after publication already includes this change.
				if (modifiedMs !== undefined) await syncHandle.utimes(new Date(), new Date(modifiedMs))
				await syncHandle.sync()
			} finally {
				await syncHandle.close()
			}
		} catch (error) {
			// Return an error
			response.setHeader('Connection', 'close')
			const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
			if (insufficientStorageHeader && (code === 'ENOSPC' || code === 'EDQUOT')) {
				response.setHeader(insufficientStorageHeader.name, insufficientStorageHeader.value)
				response.status(507).json({error: '[not-enough-space]'})
			} else {
				response.status(500).json({error: 'error writing file'})
			}
			return
		} finally {
			await temporaryFile?.close().catch(() => {})
		}
		const blake3 = hasher?.digestBuffer()

		// Choose and claim the destination while serialized with other uploads.
		// link(2) fails atomically if a keep-both/error destination appeared
		// since the initial check; unlike rename it can never replace that file.
		const publish = async (): Promise<PublishedUpload | SkippedUpload | RevisionMismatch | undefined> => {
			// Photos can reject a content duplicate while the complete bytes still
			// live only in this hidden temporary file. This avoids publishing and
			// then destructively cleaning up a pathname that another writer can
			// replace in the meantime. The shared queue also serializes this verdict
			// with publication by every other HTTP upload.
			if (blake3 && (await onBeforePublish?.(blake3)) === 'skip') return {skipped: true as const}
			while (true) {
				let candidate = requestedSystemPath
				if (await fse.pathExists(candidate)) {
					if (collision === 'error') return
					if (collision === 'keep-both') candidate = await umbreld.files.getUniqueName(candidate)
				}
				candidate = await umbreld.files.authorizeWritableDestinationSystemPath(candidate, accountId(response), {
					replace: collision === 'replace',
				})
				let stats: BigIntStats
				if (collision === 'replace') {
					// Check again while serialized with every other upload, right before
					// the rename. lstat sees the entry being replaced, never a link target.
					const replaced = await lstat(candidate, {bigint: true}).catch(() => undefined)
					if (ifMatch !== undefined && !satisfiesIfMatch(ifMatch, replaced)) return {revisionMismatch: true as const}
					// Work on a descriptor: umbreld runs as root, and SMB clients or apps
					// writing this directory could swap the temporary path for a link (or a
					// FIFO, stalling every upload here). After the rename it still names the
					// file this request published, whatever has been put at its path since.
					const temporaryFile = await open(
						temporarySystemPath,
						constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
					)
					try {
						if (replaced?.isFile()) {
							// A save keeps who can open the file. Only the permission bits carry
							// over: setuid and setgid would hand a privileged executable's rights
							// to uploaded bytes, and sticky means nothing on a file. Like the
							// umbrel chown below, this fails where mount options supply ownership
							// and modes.
							await temporaryFile.chown(Number(replaced.uid), Number(replaced.gid)).catch(() => {})
							await temporaryFile.chmod(Number(replaced.mode) & 0o777).catch(() => {})
						} else {
							// A new file, or one replacing a symlink, belongs to the umbrel user
							const {userId, groupId} = umbreld.files.fileOwner
							await temporaryFile.chown(userId, groupId).catch(() => {})
						}
						await fse.rename(temporarySystemPath, candidate)
						// Renaming moves the change time, so read the revision after it
						stats = await temporaryFile.stat({bigint: true})
					} finally {
						await temporaryFile.close()
					}
				} else {
					try {
						await publishUploadWithoutReplacing(temporarySystemPath, candidate, {modifiedMs})
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === 'EEXIST' && collision === 'keep-both') continue
						throw error
					}
					// Set owner to the umbrel user. This is expected to fail on filesystems
					// such as exFAT, where ownership is supplied by mount options.
					await umbreld.files.chownSystemPath(candidate).catch(() => {})
					stats = await lstat(candidate, {bigint: true})
				}
				const directoryHandle = await open(nodePath.dirname(candidate), constants.O_RDONLY)
				try {
					await directoryHandle.sync()
				} finally {
					await directoryHandle.close()
				}
				const upload: PublishedUpload = {
					path: umbreld.files.systemToVirtualPath(candidate),
					systemPath: candidate,
					revision: {
						inode: stats.ino.toString(),
						size: Number(stats.size),
						modifiedNs: stats.mtimeNs.toString(),
						ctimeNs: stats.ctimeNs.toString(),
					} satisfies PublishedFileRevision,
					fileRevision: fileRevision(stats),
					...(blake3 ? {blake3} : {}),
				}
				promoted = true
				void umbreld.files.fileIndex
					.movePath(temporarySystemPath, candidate)
					.catch((error) => umbreld.files.logger.error(`Failed to index uploaded file '${candidate}'`, error))
				try {
					await onPublished?.(upload)
				} catch (error) {
					// Do not delete by pathname after publication: Files/SMB can replace
					// it concurrently and POSIX has no unlink-by-descriptor primitive.
					// The filesystem stays authoritative and a later Photos sync safely
					// discovers this successfully-written file.
					throw error
				}
				return upload
			}
		}
		const enqueuePublication = () => uploadPublicationQueue.add(publish)
		// A caller-specific lifecycle lock may take arbitrarily long (for example,
		// while an iPhone source is being removed). Acquire it before taking the
		// box-wide publication slot, while still keeping its active-source check,
		// publication, and durable registration in one guarded operation.
		const publication: PublishedUpload | SkippedUpload | RevisionMismatch | undefined = publicationGuard
			? await publicationGuard(enqueuePublication, {blake3})
			: await enqueuePublication()
		if (!publication) {
			response.setHeader('Connection', 'close')
			response.status(400).json({error: '[destination-already-exists]'})
			return
		}
		if ('revisionMismatch' in publication) {
			response.setHeader('Connection', 'close')
			response.status(412).json({error: '[revision-mismatch]'})
			return
		}
		if ('skipped' in publication) return publication
		systemPath = publication.systemPath
		return publication
	} finally {
		// Restore reserved capacity only after a failed upload's temporary
		// file is confirmed gone.
		let restoreCapacity = false
		if (!promoted) {
			try {
				await fse.remove(temporarySystemPath)
				restoreCapacity = true
			} catch {
				// Keep the reservation because the partial file may remain.
			}
		}
		if (preflighted) await uploadDiskPreflight.release(temporarySystemPath, {restoreCapacity})
	}
}

const MAX_UPLOAD_LAST_MODIFIED = 253_402_300_799_999

// Reads the browser's File.lastModified from an upload's query string. Older
// clients omit it; anything but one positive epoch millisecond value up to
// year 9999 is invalid.
export function uploadLastModified(value: unknown) {
	if (value === undefined) return
	const lastModified = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0
	if (!Number.isSafeInteger(lastModified) || lastModified <= 0 || lastModified > MAX_UPLOAD_LAST_MODIFIED) {
		return 'invalid' as const
	}
	return lastModified
}

export function uploadFile(umbreld: Umbreld, uploadDiskPreflight: UploadDiskPreflight) {
	return async (request: express.Request, response: express.Response) => {
		// We must set Connection: close on early errors so browser XHR does not
		// finish streaming a rejected request body.
		if (typeof request.query.path !== 'string') {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'path is required'})
		}
		const collision = typeof request.query.collision === 'string' ? request.query.collision : 'error'
		if (collision !== 'error' && collision !== 'keep-both' && collision !== 'replace') {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'invalid collision parameter'})
		}
		// If-Match guards overwriting the revision a client read. Error and
		// keep-both never write over an existing file, so with them it could only
		// ever fail or guard nothing.
		const ifMatch = request.get('If-Match')
		if (ifMatch !== undefined && collision !== 'replace') {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'If-Match requires collision=replace'})
		}
		const lastModified = uploadLastModified(request.query.lastModified)
		if (lastModified === 'invalid') {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'invalid lastModified parameter'})
		}
		const result = await receiveUpload(umbreld, uploadDiskPreflight, request, response, {
			virtualPath: request.query.path,
			collision,
			ifMatch,
			modifiedMs: lastModified,
		})
		if (result && 'path' in result) {
			response.setHeader('ETag', `"${result.fileRevision}"`)
			response.status(200).json({path: result.path, revision: result.fileRevision})
		}
		return result && 'path' in result ? result.path : undefined
	}
}

export default function api(umbreld: Umbreld, uploadDiskPreflight: UploadDiskPreflight) {
	const api = express.Router()
	api.use(requireFileApiAuth(umbreld))

	// Serve thumbnails from the thumbnails directory
	// GET /api/files/thumbnail/:thumbnail
	// Thumbnail filenames contain either the source content hash or a source
	// revision hash, so a different rendition always has a different URL. Keep
	// the bytes private while allowing the browser to cache that URL immutably.
	api.get('/thumbnail/:thumbnail', async (request, response) => {
		try {
			if (typeof request.query.path !== 'string') throw new Error('[thumbnail-not-found]')
			const thumbnailSystemPath = await umbreld.files.thumbnails.resolveThumbnailRequest(
				request.params.thumbnail,
				request.query.path,
				accountId(response),
			)
			response.setHeader('Cache-Control', PRIVATE_IMMUTABLE_CACHE_CONTROL)
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return response.sendFile(thumbnailSystemPath, {cacheControl: false, dotfiles: 'deny'})
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})
	// Don't serve directory indexes
	// If we don't get a file hit, return a 404
	api.get('/thumbnail', (_request, response) => response.status(404).json({error: 'not found'}))

	// Downloads a file, directory or multiple files
	// GET /api/files/download?path=/Home/file.txt&path=/Home/file-2.txt
	api.get('/download', downloadFiles(umbreld))

	// Views a file
	// GET /api/files/view?path=/Home/file.txt
	api.get('/view', async (request, response) => {
		try {
			if (typeof request.query.path !== 'string') return response.status(400).json({error: 'path is required'})
			const systemPath = await umbreld.files.virtualToSystemPath(request.query.path, accountId(response))
			const status = await umbreld.files.status(systemPath, accountId(response))
			if (status.type === 'directory') return response.status(400).json({error: 'cannot view a directory'})
			// A regular file goes out with the revision clients send back in If-Match
			// (send keeps an ETag that is already set and checks conditional and range
			// requests against it). A symlink's own revision doesn't follow the bytes
			// served, so it gets the download's weak tag, which If-Match never satisfies.
			const stats = await lstat(systemPath, {bigint: true})
			response.setHeader(
				'Content-Security-Policy',
				"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
			)
			response.setHeader('X-Content-Type-Options', 'nosniff')
			const mimeType = lookupMimeType(systemPath)
			const isImageEmbed = acceptsEmbeddedSvg(request)
			// Files are user-controlled but served same-origin, so only low-risk preview types render inline.
			// All others download, with CSP sandbox and nosniff as defense-in-depth if a browser renders anyway.
			if (
				mimeType &&
				(inlineViewMimeTypes.has(mimeType) || (isImageEmbed && embedOnlyInlineViewMimeTypes.has(mimeType)))
			) {
				response.setHeader('Content-Type', mimeType)
			} else {
				const filename = nodePath.basename(systemPath)
				response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
				response.setHeader('Content-Type', 'application/octet-stream')
			}
			if (!stats.isFile()) return await sendFileRevision(response, systemPath)
			response.setHeader('ETag', `"${fileRevision(stats)}"`)
			response.sendFile(systemPath, {dotfiles: 'allow'})
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	// Uploads a file
	// POST /api/files/upload?path=/Home/file.txt&collision=error|keep-both|replace&lastModified=<ms>
	api.post('/upload', uploadFile(umbreld, uploadDiskPreflight))
	return api
}
