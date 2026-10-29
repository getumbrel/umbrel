import {once} from 'node:events'
import {chmod, chown, lstat, readdir, readFile, rename, stat, symlink, utimes, writeFile} from 'node:fs/promises'
import nodePath from 'node:path'
import type {AddressInfo} from 'node:net'
import {PassThrough} from 'node:stream'

import cookieParser from 'cookie-parser'
import express from 'express'
import got from 'got'
import pWaitFor from 'p-wait-for'
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import {OWNER_ACCOUNT_ID} from '../auth/auth.ts'
import UploadDiskPreflight from '../server/upload-disk-preflight.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import fileApi, {fileRevision, publishUploadWithoutReplacing, satisfiesIfMatch, uploadLastModified} from './api.ts'

// Runs once before the next sync of a path, to act as another writer mid-upload
const beforeSync = vi.hoisted(() => new Map<string, () => Promise<void>>())

vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>()
	return {
		...original,
		open: async (...args: Parameters<typeof original.open>) => {
			const file = await original.open(...args)
			const path = String(args[0])
			const sync = file.sync.bind(file)
			file.sync = async () => {
				const hook = beforeSync.get(path)
				beforeSync.delete(path)
				await hook?.()
				await sync()
			}
			return file
		},
	}
})

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

describe('file revisions', () => {
	const directory = temporaryDirectory()

	beforeAll(async () => await directory.createRoot())
	afterAll(async () => await directory.destroyRoot())

	test('a revision is the inode, size and nanosecond modification and change times', async () => {
		const testDirectory = await directory.create()
		await writeFile(`${testDirectory}/notes.txt`, 'notes')
		const stats = await lstat(`${testDirectory}/notes.txt`, {bigint: true})

		expect(fileRevision(stats)).toBe(`${stats.ino}-5-${stats.mtimeNs}-${stats.ctimeNs}`)
	})

	test('a same-size rewrite stamped with the old modification time is a new revision', async () => {
		const testDirectory = await directory.create()
		// A whole second, so restoring it gives back exactly the same nanoseconds
		const time = new Date('2024-01-02T03:04:05Z')
		await writeFile(`${testDirectory}/notes.txt`, 'notes')
		await utimes(`${testDirectory}/notes.txt`, time, time)
		const before = await lstat(`${testDirectory}/notes.txt`, {bigint: true})
		// File times come from a coarse clock: two changes within one tick share a change time
		await new Promise((resolve) => setTimeout(resolve, 20))
		// As an upload's lastModified, or any client's utimes, can do
		await writeFile(`${testDirectory}/notes.txt`, 'NOTES')
		await utimes(`${testDirectory}/notes.txt`, time, time)
		const after = await lstat(`${testDirectory}/notes.txt`, {bigint: true})

		expect([after.ino, after.size, after.mtimeNs]).toEqual([before.ino, before.size, before.mtimeNs])
		expect(fileRevision(after)).not.toBe(fileRevision(before))
	})

	test('If-Match only matches the strong, quoted revision of a regular file', async () => {
		const testDirectory = await directory.create()
		await writeFile(`${testDirectory}/notes.txt`, 'notes')
		await symlink(`${testDirectory}/notes.txt`, `${testDirectory}/link.txt`)
		const file = await lstat(`${testDirectory}/notes.txt`, {bigint: true})
		const link = await lstat(`${testDirectory}/link.txt`, {bigint: true})
		const revision = fileRevision(file)

		expect(satisfiesIfMatch(`"${revision}"`, file)).toBe(true)
		expect(satisfiesIfMatch(`"1-2-3", "${revision}"`, file)).toBe(true)
		expect(satisfiesIfMatch(' * ', file)).toBe(true)
		// Weak, unquoted and other revisions never match
		expect(satisfiesIfMatch(`W/"${revision}"`, file)).toBe(false)
		expect(satisfiesIfMatch(revision, file)).toBe(false)
		expect(satisfiesIfMatch('"1-2-3"', file)).toBe(false)
		expect(satisfiesIfMatch('', file)).toBe(false)
		// A missing file, a symlink or a directory has no revision to match
		expect(satisfiesIfMatch('*', undefined)).toBe(false)
		expect(satisfiesIfMatch(`"${fileRevision(link)}"`, link)).toBe(false)
		expect(satisfiesIfMatch('*', await lstat(testDirectory, {bigint: true}))).toBe(false)
	})
})

describe('revision-checked file API', () => {
	const directory = temporaryDirectory()
	const chownedToUmbrel: string[] = []
	let home: string
	let server: ReturnType<express.Express['listen']>
	let origin: string

	beforeAll(async () => {
		await directory.createRoot()
		home = await directory.create()
		const systemPrincipal = {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'} as const
		const umbreld = {
			auth: {
				authenticateDashboardCredentials: async () => systemPrincipal,
				authenticate: async () => systemPrincipal,
				authorizeHttpApi: async () => systemPrincipal,
			},
			files: {
				virtualToSystemPath: async (path: string) => `${home}${path}`,
				systemToVirtualPath: (systemPath: string) => systemPath.slice(home.length),
				status: async () => ({type: 'text/plain'}),
				authorizeWritableDestinationSystemPath: async (systemPath: string) => systemPath,
				isInternalStorageVirtualPath: () => false,
				fileOwner: {userId: 1000, groupId: 1000},
				chownSystemPath: async (systemPath: string) => void chownedToUmbrel.push(systemPath),
				fileIndex: {movePath: async () => {}},
			},
		} as unknown as Umbreld

		const app = express()
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

	const upload = (
		name: string,
		body: string | PassThrough,
		{collision = 'replace', ifMatch}: {collision?: string; ifMatch?: string} = {},
	) =>
		got.post(`${origin}/api/files/upload?path=/${name}&collision=${collision}`, {
			headers: {Authorization: 'Bearer system-token', ...(ifMatch === undefined ? {} : {'If-Match': ifMatch})},
			body,
			throwHttpErrors: false,
		})
	const view = (name: string, headers: Record<string, string> = {}) =>
		got(`${origin}/api/files/view?path=/${name}`, {
			headers: {Authorization: 'Bearer system-token', ...headers},
			throwHttpErrors: false,
		})
	const entityTag = async (name: string) => `"${fileRevision(await lstat(`${home}/${name}`, {bigint: true}))}"`
	const temporaryFiles = async (name: string) =>
		(await readdir(home)).filter((entry) => entry.startsWith(`.${name}.`) && entry.endsWith('.umbrel-upload'))

	test('view sends the strong revision that conditional and range requests validate against', async () => {
		await writeFile(`${home}/view.txt`, 'contents')
		const response = await view('view.txt')
		expect(response.headers.etag).toBe(await entityTag('view.txt'))

		expect((await view('view.txt', {'If-None-Match': response.headers.etag!})).statusCode).toBe(304)
		const range = await view('view.txt', {Range: 'bytes=0-3', 'If-Range': response.headers.etag!})
		expect(range.statusCode).toBe(206)
		expect(range.body).toBe('cont')
	})

	test('a symlink is viewed with a weak tag, which If-Match never satisfies', async () => {
		await writeFile(`${home}/target.txt`, 'contents')
		await symlink(`${home}/target.txt`, `${home}/viewed-link.txt`)
		const response = await view('viewed-link.txt')

		expect(response.statusCode).toBe(200)
		expect(response.headers.etag).toMatch(/^W\//)
	})

	test('replacing the revision a client read publishes and answers the new revision', async () => {
		await writeFile(`${home}/notes.txt`, 'original')
		const response = await upload('notes.txt', 'edited', {ifMatch: await entityTag('notes.txt')})

		expect(response.statusCode).toBe(200)
		const currentEntityTag = await entityTag('notes.txt')
		expect(response.headers.etag).toBe(currentEntityTag)
		expect(JSON.parse(response.body)).toEqual({path: '/notes.txt', revision: currentEntityTag.slice(1, -1)})
		await expect(readFile(`${home}/notes.txt`, 'utf8')).resolves.toBe('edited')
	})

	test('a stale revision or missing file is refused before the body is read', async () => {
		await writeFile(`${home}/stale.txt`, 'original')
		for (const [name, ifMatch] of [
			['stale.txt', '"1-2-3"'],
			['stale.txt', `W/${await entityTag('stale.txt')}`],
			['missing.txt', '*'],
		]) {
			// The body never ends, so any answer proves the server didn't wait for it
			const body = new PassThrough()
			body.write('edited')
			const response = await upload(name, body, {ifMatch})
			body.destroy()

			expect(response.statusCode).toBe(412)
			expect(response.headers.connection).toBe('close')
			expect(JSON.parse(response.body)).toEqual({error: '[revision-mismatch]'})
			await expect(temporaryFiles(name)).resolves.toEqual([])
		}
		await expect(readFile(`${home}/stale.txt`, 'utf8')).resolves.toBe('original')
		await expect(lstat(`${home}/missing.txt`)).rejects.toMatchObject({code: 'ENOENT'})
	})

	test('the revision is checked again right before publishing', async () => {
		await writeFile(`${home}/race.txt`, 'original')
		const body = new PassThrough()
		const response = upload('race.txt', body, {ifMatch: await entityTag('race.txt')})
		body.write('edited')

		// Change the file once the upload has passed the early check
		await pWaitFor(async () => (await temporaryFiles('race.txt')).length === 1, {interval: 10, timeout: 5000})
		await writeFile(`${home}/race.txt`, 'changed elsewhere')
		body.end()

		expect((await response).statusCode).toBe(412)
		await expect(readFile(`${home}/race.txt`, 'utf8')).resolves.toBe('changed elsewhere')
		await pWaitFor(async () => (await temporaryFiles('race.txt')).length === 0, {interval: 10, timeout: 5000})
	})

	test('the revision answered is the one published, not one renamed over it since', async () => {
		await writeFile(`${home}/shared.txt`, 'original')
		// Another writer saves over the file while the upload makes its directory durable
		beforeSync.set(home, async () => {
			await writeFile(`${home}/.shared.txt.smb`, 'saved over SMB')
			await rename(`${home}/.shared.txt.smb`, `${home}/shared.txt`)
		})
		const response = await upload('shared.txt', 'edited', {ifMatch: await entityTag('shared.txt')})
		expect(response.statusCode).toBe(200)

		expect((await upload('shared.txt', 'edited again', {ifMatch: response.headers.etag!})).statusCode).toBe(412)
		await expect(readFile(`${home}/shared.txt`, 'utf8')).resolves.toBe('saved over SMB')
	})

	test('replacing a file keeps its permission bits without setuid, setgid or sticky', async () => {
		await writeFile(`${home}/script.sh`, 'echo original')
		await chmod(`${home}/script.sh`, 0o7754)
		const response = await upload('script.sh', 'echo edited')

		expect(response.statusCode).toBe(200)
		expect((await stat(`${home}/script.sh`)).mode & 0o7777).toBe(0o754)
	})

	test.skipIf(process.getuid?.() !== 0)('replacing a file keeps its owner', async () => {
		await writeFile(`${home}/owned.txt`, 'original')
		await chown(`${home}/owned.txt`, 1234, 5678)
		const response = await upload('owned.txt', 'edited')

		expect(response.statusCode).toBe(200)
		const stats = await stat(`${home}/owned.txt`)
		expect([stats.uid, stats.gid]).toEqual([1234, 5678])
	})

	test.skipIf(process.getuid?.() !== 0)("a replaced symlink is owned by umbrel, not its target's owner", async () => {
		await writeFile(`${home}/owned-target.txt`, 'target')
		await chown(`${home}/owned-target.txt`, 1234, 5678)
		await symlink(`${home}/owned-target.txt`, `${home}/owned-link.txt`)
		const response = await upload('owned-link.txt', 'replaced the link')

		expect(response.statusCode).toBe(200)
		const stats = await lstat(`${home}/owned-link.txt`)
		expect([stats.uid, stats.gid]).toEqual([1000, 1000])
	})

	test('new files and replaced symlinks stay private and owned by umbrel', async () => {
		expect((await upload('new.txt', 'new', {collision: 'error'})).statusCode).toBe(200)
		expect((await stat(`${home}/new.txt`)).mode & 0o777).toBe(0o600)
		expect(chownedToUmbrel).toContain(`${home}/new.txt`)

		// A symlink is replaced itself, without taking on its target's attributes
		await writeFile(`${home}/target.txt`, 'target')
		await chmod(`${home}/target.txt`, 0o644)
		await symlink(`${home}/target.txt`, `${home}/link.txt`)
		expect((await upload('link.txt', 'replaced the link')).statusCode).toBe(200)
		expect((await lstat(`${home}/link.txt`)).mode & 0o777).toBe(0o600)
		await expect(readFile(`${home}/target.txt`, 'utf8')).resolves.toBe('target')
	})

	test('If-Match is refused with collision modes that never overwrite', async () => {
		await writeFile(`${home}/copy.txt`, 'original')
		for (const collision of ['error', 'keep-both']) {
			const response = await upload('copy.txt', 'copy', {collision, ifMatch: await entityTag('copy.txt')})
			expect(response.statusCode).toBe(400)
			expect(response.headers.connection).toBe('close')
			expect(JSON.parse(response.body)).toEqual({error: 'If-Match requires collision=replace'})
		}
		await expect(readdir(home)).resolves.not.toContain('copy (2).txt')
	})
})
