import http from 'node:http'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'

import type Umbreld from '../../index.ts'
import SigningKeys from './signing-keys.ts'
import {verifySigningKeysList} from './release-signing.ts'
import {createRootKey, createRootKeyHandover, createSigningKeysList} from '../test-utilities/release-signing.ts'

const alice = {name: 'alice-mbp-2026', publicKey: '026935f7c9f454e1d2be6168a78fe99b877468031d5fd2a4f0c5c0cd486d743cee'}
const bob = {name: 'bob-mbp-2025', publicKey: '032894441bab04a7d13067b4f71c168f1f341507d86c1ffdc344102eaa516c0c30'}

describe('SigningKeys', () => {
	const rootKey = createRootKey()
	let directory: string
	let bundledSigningKeysPath: string
	let files: Record<string, string>
	let server: http.Server
	let baseUrl: string

	const createSigningKeys = () => {
		const logger = {log() {}, error() {}, createChildLogger: () => logger}
		const umbreld = {dataDirectory: directory, version: '2.0.0', logger} as unknown as Umbreld
		return new SigningKeys(umbreld, {
			rootPublicKey: rootKey.publicKey,
			signingKeysUrls: [`${baseUrl}/keys-a`, `${baseUrl}/keys-b`],
			bundledSigningKeysPath,
		})
	}

	beforeAll(async () => {
		server = http.createServer((request, response) => {
			const file = files[request.url ?? '']
			response.writeHead(file === undefined ? 404 : 200)
			response.end(file)
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		await new Promise((resolve) => server.close(resolve))
	})

	beforeEach(async () => {
		directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-signing-keys-test-'))
		bundledSigningKeysPath = path.join(directory, 'bundled-signing-keys.txt')
		await fse.writeFile(
			bundledSigningKeysPath,
			createSigningKeysList({date: '2026-10-01T00:00:00Z', keys: [alice, bob], rootKey}),
		)
		files = {}
	})

	afterEach(async () => {
		await fse.remove(directory)
	})

	test('uses the bundled list until a newer one is fetched, and saves it', async () => {
		const signingKeys = createSigningKeys()
		expect((await signingKeys.get()).date).toEqual(new Date('2026-10-01T00:00:00Z'))

		// Nothing is published yet
		expect((await signingKeys.refresh()).date).toEqual(new Date('2026-10-01T00:00:00Z'))
		expect(await fse.readFile(`${directory}/umbrelos-signing-keys.txt`, 'utf8')).toBe(
			await fse.readFile(bundledSigningKeysPath, 'utf8'),
		)
	})

	// Like after updating to a release that bundles a newer list, which the sources also serve, then going
	// back to the older release, like when the new one fails to boot
	test("saves a newer bundled list, so going back to an older release doesn't forget it", async () => {
		const older = createSigningKeysList({date: '2026-09-01T00:00:00Z', keys: [alice, bob], rootKey})
		await fse.writeFile(`${directory}/umbrelos-signing-keys.txt`, older)
		const bundled = await fse.readFile(bundledSigningKeysPath, 'utf8')
		files['/keys-a'] = bundled

		expect((await createSigningKeys().refresh()).date).toEqual(new Date('2026-10-01T00:00:00Z'))
		expect(await fse.readFile(`${directory}/umbrelos-signing-keys.txt`, 'utf8')).toBe(bundled)

		// The older release bundles the older list
		await fse.writeFile(bundledSigningKeysPath, older)
		expect((await createSigningKeys().get()).date).toEqual(new Date('2026-10-01T00:00:00Z'))
	})

	test('saves the newest valid list from all sources', async () => {
		const newest = createSigningKeysList({date: '2026-10-20T00:00:00Z', keys: [alice], rootKey})
		files['/keys-a'] = createSigningKeysList({date: '2026-10-10T00:00:00Z', keys: [alice], rootKey})
		files['/keys-b'] = newest

		const list = await createSigningKeys().refresh()
		expect(list.date).toEqual(new Date('2026-10-20T00:00:00Z'))
		expect(await fse.readFile(`${directory}/umbrelos-signing-keys.txt`, 'utf8')).toBe(newest)

		// A restarted device keeps using the saved list
		expect((await createSigningKeys().get()).keys).toEqual([alice])
	})

	test('ignores lists that are forged, unsigned or older than its copy', async () => {
		files['/keys-a'] = createSigningKeysList({date: '2026-10-20T00:00:00Z', keys: [alice], rootKey})
		await createSigningKeys().refresh()

		// A newer list from another root key, a newer one without a signature and an older genuine one
		files['/keys-a'] = createSigningKeysList({date: '2026-10-30T00:00:00Z', keys: [bob], rootKey: createRootKey()})
		files['/keys-b'] = createSigningKeysList({date: '2026-10-31T00:00:00Z', keys: [bob], rootKey}).replace(
			/Root-Signature: .*\n$/,
			'',
		)
		const signingKeys = createSigningKeys()
		expect((await signingKeys.refresh()).keys).toEqual([alice])

		files['/keys-b'] = createSigningKeysList({date: '2026-10-15T00:00:00Z', keys: [bob], rootKey})
		const list = await signingKeys.refresh()
		expect(list.date).toEqual(new Date('2026-10-20T00:00:00Z'))
		expect(list.keys).toEqual([alice])
	})

	test('falls back to the bundled list if its saved copy is invalid', async () => {
		await fse.writeFile(`${directory}/umbrelos-signing-keys.txt`, 'corrupted')
		expect((await createSigningKeys().get()).date).toEqual(new Date('2026-10-01T00:00:00Z'))
	})

	test('prefers a bundled list that is newer than its saved copy', async () => {
		files['/keys-a'] = createSigningKeysList({date: '2026-10-20T00:00:00Z', keys: [alice], rootKey})
		await createSigningKeys().refresh()

		// An OS update ships a newer list
		await fse.writeFile(
			bundledSigningKeysPath,
			createSigningKeysList({date: '2026-11-01T00:00:00Z', keys: [bob], rootKey}),
		)
		expect((await createSigningKeys().get()).keys).toEqual([bob])
	})

	test('keeps a revocation when the sources go away or serve an older list again', async () => {
		files['/keys-a'] = createSigningKeysList({date: '2026-10-20T00:00:00Z', keys: [alice], rootKey})
		await createSigningKeys().refresh()

		delete files['/keys-a']
		files['/keys-b'] = await fse.readFile(bundledSigningKeysPath, 'utf8')
		expect((await createSigningKeys().refresh()).keys).toEqual([alice])
	})

	test('shares one refresh between concurrent callers', async () => {
		files['/keys-a'] = createSigningKeysList({date: '2026-10-20T00:00:00Z', keys: [alice], rootKey})
		const signingKeys = createSigningKeys()
		const [first, second] = [signingKeys.refresh(), signingKeys.refresh()]
		expect(first).toBe(second)
		expect((await first).keys).toEqual([alice])
	})

	// Like the list a release carries with its signature
	test('keeps an offered list only if it is newer', async () => {
		const signingKeys = createSigningKeys()
		const newer = createSigningKeysList({date: '2026-10-20T00:00:00Z', keys: [alice], rootKey})
		const older = createSigningKeysList({date: '2026-09-01T00:00:00Z', keys: [alice, bob], rootKey})

		expect((await signingKeys.offer(verifySigningKeysList(older, rootKey.publicKey))).date).toEqual(
			new Date('2026-10-01T00:00:00Z'),
		)
		// The device's own newest list, the bundled one, rather than the older list
		expect(await fse.readFile(`${directory}/umbrelos-signing-keys.txt`, 'utf8')).toBe(
			await fse.readFile(bundledSigningKeysPath, 'utf8'),
		)

		expect((await signingKeys.offer(verifySigningKeysList(newer, rootKey.publicKey))).keys).toEqual([alice])
		expect(await fse.readFile(`${directory}/umbrelos-signing-keys.txt`, 'utf8')).toBe(newer)
	})

	test("doesn't let a slower save of an older list overwrite a newer one", async () => {
		const newest = createSigningKeysList({date: '2026-10-20T00:00:00Z', keys: [alice], rootKey})
		files['/keys-a'] = createSigningKeysList({date: '2026-10-10T00:00:00Z', keys: [alice, bob], rootKey})
		const signingKeys = createSigningKeys()

		await Promise.all([signingKeys.refresh(), signingKeys.offer(verifySigningKeysList(newest, rootKey.publicKey))])
		expect(await fse.readFile(`${directory}/umbrelos-signing-keys.txt`, 'utf8')).toBe(newest)
	})

	// A revocation it couldn't save has to keep applying, like on a full disk
	test("keeps using the newest list when it can't save it", async () => {
		files['/keys-a'] = createSigningKeysList({date: '2026-10-20T00:00:00Z', keys: [alice], rootKey})
		const signingKeys = createSigningKeys()
		// A directory where the list is saved fails the save, even as root
		await fse.outputFile(`${directory}/umbrelos-signing-keys.txt/blocking`, '')

		expect((await signingKeys.refresh()).keys).toEqual([alice])
		expect((await fse.stat(`${directory}/umbrelos-signing-keys.txt`)).isDirectory()).toBe(true)

		delete files['/keys-a']
		expect((await signingKeys.get()).keys).toEqual([alice])
		expect((await signingKeys.refresh()).keys).toEqual([alice])
		const older = createSigningKeysList({date: '2026-10-10T00:00:00Z', keys: [alice, bob], rootKey})
		expect((await signingKeys.offer(verifySigningKeysList(older, rootKey.publicKey))).keys).toEqual([alice])

		// Once the disk is fixed, it saves the list it couldn't, so it survives a restart
		await fse.remove(`${directory}/umbrelos-signing-keys.txt`)
		await signingKeys.refresh()
		expect(await fse.readFile(`${directory}/umbrelos-signing-keys.txt`, 'utf8')).toContain('Date: 2026-10-20T00:00:00Z')
		expect((await createSigningKeys().get()).keys).toEqual([alice])
	})

	test('follows a root key handover, then ignores lists from the old root key', async () => {
		const newRootKey = createRootKey()
		const handedOver = createSigningKeysList({
			date: '2026-10-05T00:00:00Z',
			keys: [alice],
			rootKey: newRootKey,
			handovers: [createRootKeyHandover({date: '2026-10-04T00:00:00Z', from: rootKey, to: newRootKey})],
		})
		files['/keys-a'] = handedOver
		const signingKeys = createSigningKeys()
		expect((await signingKeys.refresh()).rootKey).toBe(newRootKey.publicKey)

		// The old root key's later lists don't count any more, even after a restart
		files['/keys-a'] = createSigningKeysList({date: '2026-12-01T00:00:00Z', keys: [alice, bob], rootKey})
		for (const restarted of [signingKeys, createSigningKeys()]) {
			const list = await restarted.refresh()
			expect(list.rootKey).toBe(newRootKey.publicKey)
			expect(list.keys).toEqual([alice])
		}
		expect(await fse.readFile(`${directory}/umbrelos-signing-keys.txt`, 'utf8')).toBe(handedOver)
	})

	test('fails without any valid list', async () => {
		await fse.writeFile(bundledSigningKeysPath, 'corrupted')
		await expect(createSigningKeys().refresh()).rejects.toThrow('No valid approved signing keys list found')
	})
})
