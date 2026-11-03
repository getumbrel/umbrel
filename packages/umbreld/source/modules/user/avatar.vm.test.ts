import {createHash} from 'node:crypto'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

const ownerPassword = 'moneyprintergobrrr'
const memberPassword = 'member-password'
const avatarFixtures = [
	['PNG', nodePath.resolve(__dirname, '../files/fixtures/thumbnails/master-lossless-image.png')],
	['JPEG', nodePath.resolve(__dirname, '../../../../ui/public/assets/wallpapers/16.jpg')],
	['WEBP', nodePath.resolve(__dirname, '../../../../ui/public/assets/mcp/opencode.webp')],
] as const

type AvatarResult = {userId: string; avatarUrl: string}

function avatarHash(result: AvatarResult) {
	const match = result.avatarUrl.match(
		new RegExp(`^/api/accounts/${encodeURIComponent(result.userId)}/avatar/([a-f0-9]{64})\\.webp$`),
	)
	if (!match) throw new Error(`Unexpected avatar URL: ${result.avatarUrl}`)
	return match[1]
}

// Read dimensions from any of the three WebP image chunk variants without
// requiring ImageMagick or another native image dependency on the test host.
function webpDimensions(image: Buffer) {
	if (image.subarray(0, 4).toString('ascii') !== 'RIFF' || image.subarray(8, 12).toString('ascii') !== 'WEBP') {
		throw new Error('Invalid WebP container')
	}

	for (let offset = 12; offset + 8 <= image.length; ) {
		const type = image.subarray(offset, offset + 4).toString('ascii')
		const size = image.readUInt32LE(offset + 4)
		const dataOffset = offset + 8
		if (dataOffset + size > image.length) throw new Error('Invalid WebP chunk')

		if (type === 'VP8X' && size >= 10) {
			return {
				width: image.readUIntLE(dataOffset + 4, 3) + 1,
				height: image.readUIntLE(dataOffset + 7, 3) + 1,
			}
		}
		if (type === 'VP8L' && size >= 5 && image[dataOffset] === 0x2f) {
			const dimensions = image.readUInt32LE(dataOffset + 1)
			return {width: (dimensions & 0x3fff) + 1, height: ((dimensions >>> 14) & 0x3fff) + 1}
		}
		if (
			type === 'VP8 ' &&
			size >= 10 &&
			image[dataOffset + 3] === 0x9d &&
			image[dataOffset + 4] === 0x01 &&
			image[dataOffset + 5] === 0x2a
		) {
			return {
				width: image.readUInt16LE(dataOffset + 6) & 0x3fff,
				height: image.readUInt16LE(dataOffset + 8) & 0x3fff,
			}
		}

		offset = dataOffset + size + (size % 2)
	}

	throw new Error('WebP image chunk not found')
}

describe.sequential('Account avatars', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let ownerAvatarUrl: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	const loginAs = async (userId: string, password: string) => {
		const token = await umbreld.client.user.login.mutate({userId, password})
		umbreld.setAuthToken(token)
	}

	const expectPublicAvatar = async (result: AvatarResult) => {
		const hash = avatarHash(result)
		const response = await umbreld.unauthenticatedApi.get(result.avatarUrl.replace(/^\/api\//, ''), {
			responseType: 'buffer',
		})

		expect(response.body).toBeInstanceOf(Buffer)
		expect(response.headers['content-type']).toContain('image/webp')
		expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable')
		expect(response.headers.etag).toBe(`"${hash}"`)
		expect(response.headers['x-content-type-options']).toBe('nosniff')
		expect(webpDimensions(response.body)).toEqual({width: 512, height: 512})
		expect(createHash('sha256').update(response.body).digest('hex')).toBe(hash)
	}

	const expectPublicAvatarNotFound = async (avatarUrl: string) => {
		const response = await umbreld.unauthenticatedApi.get(avatarUrl.replace(/^\/api\//, ''), {
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(404)
		expect(response.headers['cache-control']).toBe('no-store')
		expect(response.body).toEqual({error: 'Not found'})
	}

	test('rejects unauthenticated avatar writes through the real HTTP server', async () => {
		const upload = await fse.readFile(avatarFixtures[0][1])
		const response = await umbreld.unauthenticatedApi.put('accounts/0/avatar', {
			body: upload,
			throwHttpErrors: false,
		})

		expect(response.statusCode).toBe(401)
		expect(response.headers['cache-control']).toBe('no-store')
		expect(response.body).toEqual({error: 'Unauthorized'})
	})

	test('processes PNG, JPEG, and WebP into canonical 512x512 avatars with the real umbrelOS ImageMagick', async () => {
		for (const [format, fixturePath] of avatarFixtures) {
			const previousAvatarUrl = ownerAvatarUrl
			const upload = await fse.readFile(fixturePath)
			const response = await umbreld.api.put('accounts/0/avatar', {body: upload})
			const result = response.body as unknown as AvatarResult

			expect(result.userId).toBe('0')
			await expectPublicAvatar(result)
			if (previousAvatarUrl) {
				expect(result.avatarUrl, `${format} should replace the previous avatar`).not.toBe(previousAvatarUrl)
				await expectPublicAvatarNotFound(previousAvatarUrl)
			}
			ownerAvatarUrl = result.avatarUrl
		}
	})

	test('deletes the active avatar and immediately invalidates its public URL', async () => {
		const response = await umbreld.api.delete('accounts/0/avatar')

		expect(response.body).toEqual({userId: '0', avatarUrl: null})
		expect(response.headers['cache-control']).toBe('no-store')
		await expectPublicAvatarNotFound(ownerAvatarUrl)
	})

	test('enforces owner and member avatar permissions and tombstones through the real HTTP server', async () => {
		// The owner can update any active member.
		const alice = await umbreld.client.user.createUser.mutate({name: 'Alice', password: memberPassword})
		const bob = await umbreld.client.user.createUser.mutate({name: 'Bob', password: memberPassword})
		const pngUpload = await fse.readFile(avatarFixtures[0][1])
		const jpegUpload = await fse.readFile(avatarFixtures[1][1])
		const bobUpload = await umbreld.api.put(`accounts/${bob.userId}/avatar`, {body: jpegUpload})
		const bobAvatar = bobUpload.body as unknown as AvatarResult
		await expectPublicAvatar(bobAvatar)

		// A member can update only their own avatar.
		await loginAs(alice.userId, memberPassword)
		const aliceUpload = await umbreld.api.put(`accounts/${alice.userId}/avatar`, {body: pngUpload})
		const aliceAvatar = aliceUpload.body as unknown as AvatarResult
		await expectPublicAvatar(aliceAvatar)

		for (const userId of ['0', bob.userId]) {
			const forbidden = await umbreld.api.put(`accounts/${userId}/avatar`, {
				body: pngUpload,
				throwHttpErrors: false,
			})
			expect(forbidden.statusCode).toBe(403)
			expect(forbidden.headers['cache-control']).toBe('no-store')
			expect(forbidden.body).toEqual({error: 'Forbidden'})
		}

		// Tombstoning a member revokes both writes and their previously public avatar.
		await loginAs('0', ownerPassword)
		await umbreld.client.user.deleteUser.mutate({userId: bob.userId})
		const tombstoned = await umbreld.api.put(`accounts/${bob.userId}/avatar`, {
			body: pngUpload,
			throwHttpErrors: false,
		})
		expect(tombstoned.statusCode).toBe(404)
		expect(tombstoned.headers['cache-control']).toBe('no-store')
		expect(tombstoned.body).toEqual({error: 'Account not found'})
		await expectPublicAvatarNotFound(bobAvatar.avatarUrl)
	})
})
