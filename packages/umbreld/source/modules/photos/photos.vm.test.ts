import {randomBytes} from 'node:crypto'
import nodePath from 'node:path'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import AdmZip from 'adm-zip'
import fse from 'fs-extra'
import got from 'got'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

type BrowserSession = {token: string; cookies: string[]}

describe('Photos account isolation', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let ownerSession: BrowserSession
	let memberSession: BrowserSession
	let memberId: string
	let ownerItemId: string
	let sharedOwnerItemId: string
	let watchedItemId: string
	let memberItemId: string
	let memberPrivateItemId: string
	let memberWatchedItemId: string
	let failed = false

	const ownerPassword = 'moneyprintergobrrr'
	const memberPassword = 'passwordpassword'
	const fixturePath = nodePath.resolve(__dirname, '../files/fixtures/thumbnails/master-lossless-image.png')
	let image: Buffer
	let ownerImage: Buffer
	let watchedImage: Buffer
	let trashSelectedImage: Buffer
	let trashAllImage: Buffer
	let memberPrivateImage: Buffer
	let memberWatchedImage: Buffer

	function trpcData<T>(body: unknown) {
		return (body as {result?: {data?: T}}).result?.data as T
	}

	async function login(credentials: {userId?: string; password: string}) {
		const response = await got.post(`http://localhost:${umbreld.vm.httpPort}/trpc/user.login`, {
			json: credentials,
			responseType: 'json',
			retry: {limit: 0},
		})
		return {token: trpcData<string>(response.body), cookies: response.headers['set-cookie'] ?? []}
	}

	async function useSession(session: BrowserSession) {
		await umbreld.setBrowserSession(session.token, session.cookies)
	}

	async function getPhotosMedia(path: string) {
		const token = await umbreld.client.user.getHttpApiToken.query()
		const url = new URL(`http://umbrel.local/${path}`)
		url.searchParams.set('token', token)
		return umbreld.browserApi.get(`${url.pathname.replace(/^\/api\//, '')}${url.search}`, {
			responseType: 'buffer',
			throwHttpErrors: false,
		})
	}

	async function upload(name: string, body = image) {
		return umbreld.api.post(`photos/upload?name=${encodeURIComponent(name)}`, {
			body,
			responseType: 'json',
		})
	}

	async function downloadTicket(ids: string[]) {
		return (await umbreld.client.photos.items.createDownload.mutate({ids})).ticket
	}

	async function waitForReady() {
		await pRetry(
			async () => expect(await umbreld.client.photos.library.status.query()).toMatchObject({phase: 'ready'}),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
	}

	async function photoItemNamed(name: string) {
		return pRetry(
			async () => {
				const page = await umbreld.client.photos.items.list.query({filter: {query: name}, limit: 10})
				expect(page.total).toBe(1)
				return page.items[0]!
			},
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
	}

	beforeAll(async () => {
		image = await fse.readFile(fixturePath)
		// PNG decoders ignore trailing application bytes, while BLAKE3 still gives
		// each fixture a distinct logical identity. The unmodified image is reused
		// deliberately for the one cross-account same-content case.
		ownerImage = Buffer.concat([image, Buffer.from('owner-private')])
		watchedImage = Buffer.concat([image, Buffer.from('owner-watched')])
		trashSelectedImage = Buffer.concat([image, Buffer.from('trash-selected')])
		trashAllImage = Buffer.concat([image, Buffer.from('trash-all')])
		memberPrivateImage = Buffer.concat([image, Buffer.from('member-private')])
		memberWatchedImage = Buffer.concat([image, Buffer.from('member-watched')])
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.signup()
		ownerSession = await login({password: ownerPassword})
		await useSession(ownerSession)
		const member = await umbreld.client.user.createUser.mutate({name: 'photo-member', password: memberPassword})
		memberId = member.userId
		memberSession = await login({userId: memberId, password: memberPassword})
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('requires authentication for Photos RPC and media endpoints', async () => {
		await expect(umbreld.unauthenticatedClient.photos.library.summary.query()).rejects.toThrow()
		const response = await umbreld.unauthenticatedApi.get('photos/original/unknown', {
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(401)
	})

	test('indexes the owner library and serves its original and thumbnail', async () => {
		await useSession(ownerSession)
		await expect(upload('owner-photo.png', ownerImage)).resolves.toMatchObject({body: {status: 'imported'}})
		await waitForReady()

		const page = await umbreld.client.photos.items.list.query({filter: {}, limit: 10})
		expect(page.total).toBe(1)
		ownerItemId = page.items[0]!.id
		await expect(umbreld.client.photos.items.get.query({id: ownerItemId})).resolves.toMatchObject({
			id: ownerItemId,
			path: '/Home/Photos/owner-photo.png',
		})

		const original = await getPhotosMedia(`api/photos/original/${ownerItemId}`)
		expect(original.statusCode).toBe(200)
		expect(original.body).toEqual(ownerImage)
		expect(original.headers['cache-control']).toBe('private, max-age=31536000, immutable')
		for (const size of [192, 512, 1280]) {
			const thumbnail = await getPhotosMedia(`api/photos/thumb/${ownerItemId}?s=${size}`)
			expect(thumbnail.statusCode).toBe(200)
			expect(thumbnail.headers['content-type']).toBe('image/webp')
			expect(thumbnail.headers['cache-control']).toBe('private, max-age=31536000, immutable')
			expect(thumbnail.body.length).toBeGreaterThan(0)
		}
	})

	test('serves every Photos rendition with oriented short-edge sizing and no upscaling', async () => {
		await useSession(ownerSession)
		const directory = `${umbreld.vm.dataDirectory}/home/Photos/short-edge-renditions`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${directory}'
			convert -size 3000x2000 xc:red '${directory}/shortedge-landscape.png'
			convert -size 2000x3000 xc:blue '${directory}/shortedge-portrait.png'
			convert -size 2000x2000 xc:yellow '${directory}/shortedge-square.png'
			convert -size 100x50 xc:purple '${directory}/shortedge-small.png'
			convert -size 4000x1000 xc:orange '${directory}/shortedge-panorama.png'
			convert -size 3000x2000 xc:green '${directory}/shortedge-orientation-base.jpg'
			node -e '
				const fs = require("node:fs")
				const source = fs.readFileSync("${directory}/shortedge-orientation-base.jpg")
				const payload = Buffer.alloc(32)
				payload.write("Exif\\0\\0", 0, "binary")
				payload.write("II", 6, "ascii")
				payload.writeUInt16LE(42, 8)
				payload.writeUInt32LE(8, 10)
				payload.writeUInt16LE(1, 14)
				payload.writeUInt16LE(0x0112, 16)
				payload.writeUInt16LE(3, 18)
				payload.writeUInt32LE(1, 20)
				payload.writeUInt16LE(6, 24)
				payload.writeUInt32LE(0, 28)
				const segment = Buffer.alloc(4 + payload.length)
				segment.writeUInt16BE(0xffe1, 0)
				segment.writeUInt16BE(payload.length + 2, 2)
				payload.copy(segment, 4)
				fs.writeFileSync(
					"${directory}/shortedge-rotated.jpg",
					Buffer.concat([source.subarray(0, 2), segment, source.subarray(2)]),
				)
				fs.unlinkSync("${directory}/shortedge-orientation-base.jpg")
			'
		`)
		await photoItemNamed('shortedge-landscape')
		await waitForReady()

		const expectations: Record<string, Record<number, string>> = {
			'shortedge-landscape': {192: '288x192', 512: '768x512', 1280: '1920x1280'},
			'shortedge-portrait': {192: '192x288', 512: '512x768', 1280: '1280x1920'},
			'shortedge-square': {192: '192x192', 512: '512x512', 1280: '1280x1280'},
			'shortedge-small': {192: '100x50', 512: '100x50', 1280: '100x50'},
			'shortedge-panorama': {192: '768x192', 512: '2048x512', 1280: '4000x1000'},
			'shortedge-rotated': {192: '192x288', 512: '512x768', 1280: '1280x1920'},
		}
		const variants = {
			192: 'preview-192-webp-v1',
			512: 'preview-512-webp-v2',
			1280: 'preview-1280-webp-v2',
		} as const
		for (const [name, dimensions] of Object.entries(expectations)) {
			const item = await photoItemNamed(name)
			expect(item.id).toMatch(/^[a-f0-9]{64}$/)
			for (const size of [192, 512, 1280] as const) {
				const response = await getPhotosMedia(`api/photos/thumb/${item.id}?s=${size}`)
				expect(response.statusCode).toBe(200)
				const artifact = `${umbreld.vm.dataDirectory}/thumbnails/content/${variants[size]}/${item.id.slice(0, 2)}/${item.id}.webp`
				await expect(umbreld.vm.sshAsRoot(`identify -quiet -format '%wx%h' '${artifact}[0]'`)).resolves.toBe(
					dimensions[size],
				)
			}
		}
	})

	test('discovers Files changes, applies source scope, and preserves ids across moves', async () => {
		await useSession(ownerSession)
		await umbreld.api.post(`files/upload?path=${encodeURIComponent('/Home/Camera/watched-photo.png')}`, {
			body: watchedImage,
		})
		await pRetry(
			async () =>
				expect(await umbreld.client.photos.items.list.query({filter: {}, limit: 10})).toMatchObject({total: 8}),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		await waitForReady()
		const watched = await umbreld.client.photos.items.list.query({filter: {query: 'watched-photo'}, limit: 10})
		expect(watched.total).toBe(1)
		watchedItemId = watched.items[0]!.id

		const source = (await umbreld.client.photos.sources.list.query()).find(({type}) => type === 'umbrel')!
		await umbreld.client.photos.sources.update.mutate({
			id: source.id,
			scope: {mode: 'only', paths: ['/Home/Photos']},
		})
		await expect(umbreld.client.photos.items.list.query({filter: {}, limit: 10})).resolves.toMatchObject({total: 7})
		await expect(umbreld.client.photos.items.get.query({id: watchedItemId})).rejects.toThrow()
		await umbreld.client.photos.sources.update.mutate({id: source.id, scope: {mode: 'everything', paths: []}})
		await expect(umbreld.client.photos.items.list.query({filter: {}, limit: 10})).resolves.toMatchObject({total: 8})

		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/Camera/watched-photo.png', newName: 'renamed-photo.png'}),
		).resolves.toBe('/Home/Camera/renamed-photo.png')
		await pRetry(
			async () =>
				expect(await umbreld.client.photos.items.get.query({id: watchedItemId})).toMatchObject({
					path: '/Home/Camera/renamed-photo.png',
				}),
			{retries: 120, factor: 1, minTimeout: 100, maxTimeout: 100},
		)

		const archive = await getPhotosMedia(
			`api/photos/download?ticket=${encodeURIComponent(await downloadTicket([ownerItemId, watchedItemId]))}`,
		)
		expect(archive.statusCode).toBe(200)
		expect(archive.headers['content-type']).toBe('application/zip')
		const downloaded = Object.fromEntries(
			new AdmZip(archive.body).getEntries().map((entry) => [entry.entryName, entry.getData()]),
		)
		expect(downloaded['owner-photo.png']).toEqual(ownerImage)
		expect(downloaded['renamed-photo.png']).toEqual(watchedImage)
	})

	test('uses Files Trash for delete and restore, then permanently deletes only Trash media', async () => {
		await useSession(ownerSession)
		const selectedPath = '/Home/Camera/trash-lifecycle-selected.png'
		const allPath = '/Home/Camera/trash-lifecycle-all.png'
		const textPath = '/Home/Camera/trash-lifecycle-keep.txt'
		await Promise.all([
			umbreld.api.post(`files/upload?path=${encodeURIComponent(selectedPath)}`, {body: trashSelectedImage}),
			umbreld.api.post(`files/upload?path=${encodeURIComponent(allPath)}`, {body: trashAllImage}),
			umbreld.api.post(`files/upload?path=${encodeURIComponent(textPath)}`, {body: 'keep this non-media file'}),
		])
		const selected = await photoItemNamed('trash-lifecycle-selected')
		const all = await photoItemNamed('trash-lifecycle-all')

		// Deleting in Photos performs a real Files move, and the Trash-backed
		// item remains addressable by the viewer through the deleted projection.
		await expect(umbreld.client.photos.items.delete.mutate({ids: [selected.id]})).resolves.toBe(1)
		await expect(umbreld.client.photos.items.get.query({id: selected.id})).rejects.toThrow()
		await expect(umbreld.client.photos.items.get.query({id: selected.id, deleted: true})).resolves.toMatchObject({
			id: selected.id,
			path: '/Trash/trash-lifecycle-selected.png',
		})
		expect((await umbreld.client.files.list.query({path: '/Trash'})).files.map(({name}) => name)).toContain(
			'trash-lifecycle-selected.png',
		)

		// Restore delegates to Files too, including its original-path metadata.
		await expect(umbreld.client.photos.items.restore.mutate({ids: [selected.id]})).resolves.toBe(1)
		await expect(umbreld.client.photos.items.get.query({id: selected.id})).resolves.toMatchObject({path: selectedPath})
		await expect(umbreld.client.photos.items.get.query({id: selected.id, deleted: true})).rejects.toThrow()

		// Trash changes made in Files flow back into Photos. Keep a non-media file
		// beside both photos to prove that Photos' all action cannot empty Trash.
		const selectedTrashPath = await umbreld.client.files.trash.mutate({path: selectedPath})
		const allTrashPath = await umbreld.client.files.trash.mutate({path: allPath})
		const textTrashPath = await umbreld.client.files.trash.mutate({path: textPath})
		await pRetry(
			async () => {
				const page = await umbreld.client.photos.items.list.query({
					filter: {deleted: true, query: 'trash-lifecycle'},
					limit: 10,
				})
				expect(page.total).toBe(2)
				expect(page.items.map(({id}) => id).sort()).toStrictEqual([selected.id, all.id].sort())
			},
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)

		// A selected permanent deletion removes only that media file.
		await expect(umbreld.client.photos.items.deletePermanently.mutate({ids: [selected.id]})).resolves.toBe(1)
		let trashNames = (await umbreld.client.files.list.query({path: '/Trash'})).files.map(({name}) => name)
		expect(trashNames).not.toContain(nodePath.basename(selectedTrashPath))
		expect(trashNames).toContain(nodePath.basename(allTrashPath))
		expect(trashNames).toContain(nodePath.basename(textTrashPath))

		// Omitting ids permanently deletes every remaining photo/video in Trash,
		// while leaving unrelated Trash entries untouched.
		await expect(umbreld.client.photos.items.deletePermanently.mutate({})).resolves.toBe(1)
		trashNames = (await umbreld.client.files.list.query({path: '/Trash'})).files.map(({name}) => name)
		expect(trashNames).not.toContain(nodePath.basename(allTrashPath))
		expect(trashNames).toContain(nodePath.basename(textTrashPath))
		await expect(
			umbreld.client.photos.items.list.query({filter: {deleted: true, query: 'trash-lifecycle'}, limit: 10}),
		).resolves.toMatchObject({total: 0})

		// Leave the shared stateful VM clean for the account-isolation checks.
		await expect(umbreld.client.files.delete.mutate({path: textTrashPath})).resolves.toBe(true)
	})

	test('uses one hash identity across accounts without sharing locations or state', async () => {
		await useSession(ownerSession)
		await expect(upload('owner-shared.png')).resolves.toMatchObject({body: {status: 'imported'}})
		sharedOwnerItemId = (await photoItemNamed('owner-shared')).id

		await useSession(memberSession)
		await expect(upload('member-photo.png')).resolves.toMatchObject({body: {status: 'imported'}})
		await waitForReady()

		const page = await umbreld.client.photos.items.list.query({filter: {}, limit: 10})
		expect(page.total).toBe(1)
		memberItemId = page.items[0]!.id
		expect(memberItemId).toBe(sharedOwnerItemId)
		await expect(umbreld.client.photos.items.get.query({id: memberItemId})).resolves.toMatchObject({
			id: memberItemId,
			path: `/Users/${memberId}/Photos/member-photo.png`,
		})
		await expect(umbreld.client.photos.items.get.query({id: ownerItemId})).rejects.toThrow()

		// Supplying a guessed owner-only hash cannot smuggle it into a member
		// album, while the shared hash is authorized through the member location.
		const album = await umbreld.client.photos.albums.create.mutate({
			name: 'Member album',
			ids: [ownerItemId, memberItemId],
		})
		expect(album).toMatchObject({count: 1, coverId: memberItemId})

		// Dedupe is account-local: the first member copy imported above, while a
		// second member copy is recognized without creating another library item.
		await expect(upload('member-duplicate.png')).resolves.toMatchObject({body: {status: 'duplicate'}})
		await expect(umbreld.client.photos.items.list.query({filter: {}, limit: 10})).resolves.toMatchObject({total: 1})
		await expect(upload('member-private.png', memberPrivateImage)).resolves.toMatchObject({body: {status: 'imported'}})
		memberPrivateItemId = (await photoItemNamed('member-private')).id
		expect(memberPrivateItemId).not.toBe(memberItemId)

		// The member's independently-watched Home root feeds Photos too; this is
		// not limited to uploads made through the Photos screen.
		const watchedPath = `/Users/${memberId}/Camera/files-photo.png`
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(watchedPath)}`, {body: memberWatchedImage})
		await pRetry(
			async () =>
				expect(await umbreld.client.photos.items.list.query({filter: {query: 'files-photo'}, limit: 10})).toMatchObject(
					{
						total: 1,
					},
				),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		const watched = await umbreld.client.photos.items.list.query({filter: {query: 'files-photo'}, limit: 10})
		memberWatchedItemId = watched.items[0]!.id
		await expect(umbreld.client.photos.items.get.query({id: watched.items[0]!.id})).resolves.toMatchObject({
			path: watchedPath,
		})
		await umbreld.client.files.trash.mutate({path: watchedPath})
		await pRetry(
			async () =>
				expect(await umbreld.client.photos.items.list.query({filter: {query: 'files-photo'}, limit: 10})).toMatchObject(
					{
						total: 0,
					},
				),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
	})

	test('does not serve another account original or content-addressed thumbnail', async () => {
		await useSession(ownerSession)
		const ownerDownloadTicket = await downloadTicket([ownerItemId])
		await useSession(memberSession)
		await expect(downloadTicket([ownerItemId])).rejects.toThrow()
		for (const path of [
			`api/photos/original/${ownerItemId}`,
			...([192, 512, 1280] as const).map((size) => `api/photos/thumb/${ownerItemId}?s=${size}`),
			`api/photos/live/${ownerItemId}`,
			`api/photos/download?ticket=${encodeURIComponent(ownerDownloadTicket)}`,
		]) {
			expect((await getPhotosMedia(path)).statusCode).toBe(404)
		}
		// A same-hash id resolves through this account's own location, never the
		// canonical path selected for another account.
		expect((await getPhotosMedia(`api/photos/original/${memberItemId}`)).body).toEqual(image)
		for (const size of [192, 512, 1280]) {
			expect((await getPhotosMedia(`api/photos/thumb/${memberItemId}?s=${size}`)).statusCode).toBe(200)
		}

		await useSession(ownerSession)
		await expect(umbreld.client.photos.items.get.query({id: memberItemId})).resolves.toMatchObject({
			id: memberItemId,
			path: '/Home/Photos/owner-shared.png',
		})
		expect((await getPhotosMedia(`api/photos/original/${memberPrivateItemId}`)).statusCode).toBe(404)
		for (const size of [192, 512, 1280]) {
			expect((await getPhotosMedia(`api/photos/thumb/${memberPrivateItemId}?s=${size}`)).statusCode).toBe(404)
		}
		expect((await getPhotosMedia(`api/photos/live/${memberPrivateItemId}`)).statusCode).toBe(404)
		await expect(downloadTicket([memberPrivateItemId])).rejects.toThrow()
		expect(
			(await getPhotosMedia(`api/photos/download?ticket=${encodeURIComponent(ownerDownloadTicket)}`)).body,
		).toEqual(ownerImage)
		expect((await getPhotosMedia(`api/photos/original/${ownerItemId}`)).body).toEqual(ownerImage)
	})

	test('keeps account state isolated while shared artifacts survive deletion and reboot', async () => {
		await useSession(memberSession)
		await umbreld.client.photos.items.setFavorite.mutate({ids: [memberItemId], favorite: true})
		await umbreld.client.photos.items.delete.mutate({ids: [memberItemId]})
		await expect(umbreld.client.photos.library.summary.query()).resolves.toMatchObject({
			counts: {items: 1, favorites: 0, deleted: 2},
		})

		await useSession(ownerSession)
		await expect(umbreld.client.photos.library.summary.query()).resolves.toMatchObject({
			counts: {items: 9, favorites: 0, deleted: 0},
		})
		expect((await getPhotosMedia(`api/photos/thumb/${ownerItemId}?s=192`)).statusCode).toBe(200)

		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		ownerSession = await login({password: ownerPassword})
		await useSession(ownerSession)
		await waitForReady()
		await expect(umbreld.client.photos.items.get.query({id: ownerItemId})).resolves.toMatchObject({
			id: ownerItemId,
		})
		await expect(umbreld.client.photos.items.get.query({id: watchedItemId})).resolves.toMatchObject({
			id: watchedItemId,
			path: '/Home/Camera/renamed-photo.png',
		})

		memberSession = await login({userId: memberId, password: memberPassword})
		await useSession(memberSession)
		await expect(umbreld.client.photos.items.list.query({filter: {deleted: true}, limit: 10})).resolves.toMatchObject({
			total: 2,
			items: expect.arrayContaining([
				expect.objectContaining({id: memberItemId, isFavorite: true}),
				expect.objectContaining({id: memberWatchedItemId}),
			]),
		})
	})

	test('keeps enriching past an undecodable file until other media settles, then reports degraded', async () => {
		await useSession(ownerSession)
		type Status = Awaited<ReturnType<typeof umbreld.client.photos.library.status.query>>
		const settledDegraded = (total: number) => ({
			phase: 'degraded',
			total,
			completed: total - 1,
			error: 'Some media could not be prepared',
		})

		// A file with a photo extension but random content fails to prepare. It
		// must land in the failed count rather than leaving the library enriching.
		const {total: baseTotal} = (await umbreld.client.photos.library.status.query()) as {total: number}
		const undecodablePath = '/Home/Photos/undecodable.jpg'
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(undecodablePath)}`, {
			body: randomBytes(64 * 1024),
		})
		await pRetry(
			async () => {
				expect(await umbreld.client.photos.library.status.query()).toMatchObject(settledDegraded(baseTotal + 1))
			},
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)

		// Add a batch of large photos while that failure is known. Each is written
		// as a JPEG under a .part name and renamed into place so the indexer never
		// sees a partly-written image, and each has distinct trailing bytes so they
		// are separate content.
		const count = 12
		const directory = `${umbreld.vm.dataDirectory}/home/Photos/degraded-batch`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${directory}'
			convert -seed 1 -size 4000x3000 plasma:fractal jpg:'${directory}/base.jpg.part'
			for i in $(seq 1 ${count}); do
				cp '${directory}/base.jpg.part' "${directory}/batch-$i.jpg.part"
				printf 'batch-%s' "$i" >> "${directory}/batch-$i.jpg.part"
			done
			rm '${directory}/base.jpg.part'
			for i in $(seq 1 ${count}); do mv "${directory}/batch-$i.jpg.part" "${directory}/batch-$i.jpg"; done
		`)

		// Poll until the library settles. While good media is still pending the
		// library is enriching; it is only degraded once everything else is done.
		const observed: Status[] = []
		await pRetry(
			async () => {
				const status = await umbreld.client.photos.library.status.query()
				observed.push(status)
				expect(status).toMatchObject(settledDegraded(baseTotal + 1 + count))
			},
			{retries: 1200, factor: 1, minTimeout: 100, maxTimeout: 100},
		)
		for (const status of observed) {
			if (status.phase === 'degraded') expect(status).toMatchObject({completed: status.total! - 1})
		}
		expect(observed.some((status) => status.phase === 'enriching' && status.completed + 1 < status.total)).toBe(true)

		// Removing the undecodable file leaves a fully prepared library.
		const trashed = await umbreld.client.files.trash.mutate({path: undecodablePath})
		await waitForReady()
		await expect(umbreld.client.photos.library.status.query()).resolves.toEqual({
			phase: 'ready',
			total: baseTotal + count,
			completed: baseTotal + count,
			percentage: 100,
		})
		await expect(umbreld.client.files.delete.mutate({path: trashed})).resolves.toBe(true)
	})
})
