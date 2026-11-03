import nodePath from 'node:path'
import crypto from 'node:crypto'

import {expect, test, beforeEach, beforeAll, afterAll} from 'vitest'
import fse from 'fs-extra'
import got from 'got'
import {CookieJar} from 'tough-cookie'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

beforeEach(async () => {
	// The directory is owned by umbreld running as root in the VM.
	await umbreld.vm.sshAsRoot('rm -rf /home/umbrel/umbrel/thumbnails/* || true')
})

const guestThumbnailDir = '/home/umbrel/umbrel/thumbnails'
const variant = 'preview-192-webp-v1'

async function createThumbnail(virtualPath: string) {
	const fixturePath = nodePath.resolve(__dirname, 'fixtures', 'thumbnails', 'master-lossless-image.png')
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(virtualPath)}`, {
		body: await fse.readFile(fixturePath),
	})
	return umbreld.client.files.getThumbnail.mutate({path: virtualPath})
}

function apiPath(url: string) {
	return url.replace(/^\/api\//, '')
}

function trpcData<T>(body: unknown) {
	return (body as {result?: {data?: T}}).result?.data as T
}

function thumbnailFilename(url: string) {
	return nodePath.basename(new URL(url, 'http://localhost').pathname)
}

function thumbnailSystemPath(url: string) {
	const match = new RegExp(`^(content|transient)-${variant}-([a-f0-9]{64})\\.webp$`, 'i').exec(thumbnailFilename(url))
	if (!match) throw new Error(`Unexpected thumbnail URL: ${url}`)
	const kind = match[1].toLowerCase()
	const key = match[2].toLowerCase()
	return `${guestThumbnailDir}/${kind}/${variant}/${key.slice(0, 2)}/${key}.webp`
}

async function readThumbnail(url: string) {
	const encoded = await umbreld.vm.sshAsRoot(`base64 -w 0 '${thumbnailSystemPath(url)}'`)
	return Buffer.from(encoded.trim(), 'base64')
}

test('GET /api/files/thumbnail/:thumbnail throws unauthorized error without cookie', async () => {
	const hash = crypto.createHash('sha256').update('unauthorized').digest('hex')
	const error = await umbreld.unauthenticatedApi
		.get(`files/thumbnail/${hash}.webp?path=${encodeURIComponent('/Home/private.png')}`)
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(401)
	expect(error.response.body).toMatchObject({error: 'unauthorized'})
})

test('GET /api/files/thumbnail/:thumbnail throws 404 error without a thumbnail path', async () => {
	const error = await umbreld.api.get('files/thumbnail/').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
})

test('GET /api/files/thumbnail/:thumbnail requires a source path', async () => {
	const hash = crypto.createHash('sha256').update('missing-path').digest('hex')
	const error = await umbreld.api.get(`files/thumbnail/${hash}.webp`).catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
})

test('GET /api/files/thumbnail/:thumbnail throws 404 error when the source does not exist', async () => {
	const validHash = crypto.createHash('sha256').update('nonexistent-file').digest('hex')
	const error = await umbreld.api
		.get(`files/thumbnail/${validHash}.webp?path=${encodeURIComponent('/Home/nonexistent.png')}`)
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
})

test('GET /api/files/thumbnail/:thumbnail serves an authorized thumbnail with immutable private caching', async () => {
	const thumbnailUrl = await createThumbnail('/Home/thumbnail-api/cache.png')

	const response = await umbreld.api.get(apiPath(thumbnailUrl), {responseType: 'buffer'})

	expect(response.statusCode).toBe(200)
	expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable')
	expect(response.headers.etag).toBeTypeOf('string')
	expect(response.headers['content-type']).toBe('image/webp')
	expect(response.body.length).toBeGreaterThan(0)
	expect(response.body).toEqual(await readThumbnail(thumbnailUrl))
})

test('GET /api/files/thumbnail/:thumbnail rejects a hash that does not match the authorized source path', async () => {
	const thumbnailUrl = await createThumbnail('/Home/thumbnail-api/hash-binding.png')
	const wrongHash = crypto.createHash('sha256').update('another-thumbnail').digest('hex')
	const wrongUrl = thumbnailUrl.replace(/[a-f0-9]{64}\.webp/i, `${wrongHash}.webp`)

	const error = await umbreld.api.get(apiPath(wrongUrl)).catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
})

test('GET /api/files/thumbnail/:thumbnail follows member share grants and revocation', async () => {
	const memberCredentials = {name: 'thumbnail-member', password: 'passwordpassword'}
	const member = await umbreld.client.user.createUser.mutate(memberCredentials)
	const thumbnailUrl = await createThumbnail('/Home/thumbnail-shared/image.png')

	const cookieJar = new CookieJar()
	const login = await got.post(`http://localhost:${umbreld.vm.httpPort}/trpc/user.login`, {
		json: {userId: member.userId, password: memberCredentials.password},
		cookieJar,
		responseType: 'json',
	})
	const dashboardToken = trpcData<string>(login.body)
	const httpTokenResponse = await got.get(`http://localhost:${umbreld.vm.httpPort}/trpc/user.getHttpApiToken`, {
		headers: {Authorization: `Bearer ${dashboardToken}`},
		cookieJar,
		responseType: 'json',
	})
	const httpToken = trpcData<string>(httpTokenResponse.body)
	const memberThumbnailUrl = `${apiPath(thumbnailUrl)}&token=${httpToken}`
	const memberApi = got.extend({
		prefixUrl: `http://localhost:${umbreld.vm.httpPort}/api`,
		cookieJar,
		retry: {limit: 0},
		responseType: 'buffer',
	})

	// Knowing a valid thumbnail URL is not enough without access to its source.
	let response = await memberApi.get(memberThumbnailUrl, {throwHttpErrors: false})
	expect(response.statusCode).toBe(404)

	await umbreld.client.files.addMemberShare.mutate({
		path: '/Home/thumbnail-shared',
		sharedWith: [member.userId],
	})
	response = await memberApi.get(memberThumbnailUrl, {throwHttpErrors: false})
	expect(response.statusCode).toBe(200)
	await umbreld.client.files.removeMemberShare.mutate({path: '/Home/thumbnail-shared'})
	response = await memberApi.get(memberThumbnailUrl, {throwHttpErrors: false})
	expect(response.statusCode).toBe(404)
})
