import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import semver from 'semver'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import {
	BUNDLED_SIGNING_KEYS_PATH,
	DOWNLOAD_SIZE_LIMIT,
	ROOT_PUBLIC_KEY,
	findUpdateBundle,
	parseReleaseManifest,
	readSignatureFile,
	verifyRelease,
	verifySigningKeysList,
} from '../source/modules/update/release-signing.ts'
import {
	createManifest,
	createReleaseNotesMessage,
	createRootKey,
	createSigningKeysList,
	createSigningKey,
	signRelease,
	signBitcoinMessage,
	signingKey,
	signerSign,
	type SignerKey,
} from '../source/modules/test-utilities/release-signing.ts'
import {
	ARCHIVE_DIRECTORY,
	KEYS_ARCHIVE_DIRECTORY,
	PUBLISHED_SIGNING_KEYS_PATH,
	addReleaseSignature,
	confirmationCode,
	archivedSigningKeysListName,
	keepValidSignatures,
	readRelease,
	shellQuote,
	showHidden,
} from './release-signing.ts'

// Signing a release that needs more than one signer, one signer at a time
describe('addReleaseSignature()', () => {
	const rootKey = createRootKey()
	const manifest = createManifest('2.1.0')
	const message = manifest.trim()
	let directory: string
	let alice: SignerKey
	let bob: SignerKey
	let signingKeysList: string

	beforeAll(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), 'umbrel-release-signing-script-test-'))
		;[alice, bob] = await Promise.all([createSigningKey('alice'), createSigningKey('bob')])
		signingKeysList = createSigningKeysList({
			date: '2026-10-22T00:00:00Z',
			requiredSignatures: 2,
			keys: [signingKey(alice), signingKey(bob)],
			rootKey,
		})
	})

	afterAll(async () => {
		await fs.rm(directory, {recursive: true, force: true})
	})

	// A signer's signature of the manifest, named after their approved key
	const signedBy = async (signer: SignerKey) => ({
		name: signer.name,
		signature: signerSign(message, signer),
	})

	const verify = (signatureFile: string) => {
		const manifestSignatures = readSignatureFile(signatureFile, rootKey.publicKey)
		return verifyRelease({manifest, manifestSignatures, signingKeys: manifestSignatures.signingKeys!})
	}

	test('collects signatures until a release has as many as it needs', async () => {
		const first = addReleaseSignature({signingKeysList, signatures: [], signature: await signedBy(alice)})
		await expect(verify(first)).rejects.toThrow('This release has 1 of the 2 signatures it needs')

		const second = addReleaseSignature({
			signingKeysList,
			signatures: readSignatureFile(first, rootKey.publicKey).signatures,
			signature: await signedBy(bob),
		})
		expect((await verify(second)).signers.map((signer) => signer.name)).toEqual(['alice', 'bob'])
	})

	test("replaces a signer's earlier signature rather than counting it twice", async () => {
		const aliceSignature = await signedBy(alice)
		const signatureFile = addReleaseSignature({
			signingKeysList,
			signatures: [aliceSignature, await signedBy(bob)],
			signature: aliceSignature,
		})
		expect(readSignatureFile(signatureFile, rootKey.publicKey).signatures).toHaveLength(2)
	})

	test('carries the list given, like a newer one approved since the first signature', async () => {
		const newerList = createSigningKeysList({
			date: '2026-10-23T00:00:00Z',
			keys: [signingKey(alice), signingKey(bob)],
			rootKey,
		})
		const signatureFile = addReleaseSignature({
			signingKeysList: newerList,
			signatures: [await signedBy(alice)],
			signature: await signedBy(bob),
		})
		expect(readSignatureFile(signatureFile, rootKey.publicKey).signingKeys!.text).toBe(newerList)
	})

	test('keeps a signature by the root key', async () => {
		const rootSignature = [signBitcoinMessage(message, rootKey.privateKey)]
		const signatureFile = addReleaseSignature({
			signingKeysList,
			signatures: [],
			rootSignatures: rootSignature,
			signature: await signedBy(alice),
		})
		expect(readSignatureFile(signatureFile, rootKey.publicKey).rootSignatures).toEqual(rootSignature)
	})

	// The download server could put one there to stop the next signer adding theirs
	test('drops signatures devices could not read', async () => {
		const signatureFile = addReleaseSignature({
			signingKeysList,
			signatures: [{name: 'alice', signature: 'AAAA'}],
			signature: await signedBy(alice),
		})
		expect(readSignatureFile(signatureFile, rootKey.publicKey).signatures).toHaveLength(1)
	})
})

// Signing a release again after its signer's key is revoked, or its release notes change
describe('keepValidSignatures()', () => {
	const rootKey = createRootKey()
	const message = createReleaseNotesMessage('2.1.0', 'Notes')
	let directory: string
	let alice: SignerKey
	let bob: SignerKey

	beforeAll(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), 'umbrel-release-signing-keep-test-'))
		;[alice, bob] = await Promise.all([createSigningKey('alice'), createSigningKey('bob')])
	})

	afterAll(async () => {
		await fs.rm(directory, {recursive: true, force: true})
	})

	const signaturesOf = (message: string) =>
		Promise.all(
			[alice, bob].map(async (signer) => ({
				name: signer.name,
				signature: signerSign(message, signer),
			})),
		)
	const rootSignatureOf = (message: string, key = rootKey) => signBitcoinMessage(message, key.privateKey)

	test("drops signatures the list doesn't accept", async () => {
		const signatures = await signaturesOf(message)
		const rootSignatures = [rootSignatureOf(message), rootSignatureOf(message, createRootKey())]
		// Bob was revoked
		const kept = keepValidSignatures({
			message,
			signatures: [...signatures, {...signatures[0], name: 'bob'}],
			rootSignatures,
			signingKeys: {keys: [signingKey(alice)], rootKey: rootKey.publicKey},
		})
		expect(kept).toEqual({signatures: [signatures[0]], rootSignatures: [rootSignatures[0]]})
	})

	// Like after fixing the release notes
	test('drops signatures of other release notes', async () => {
		const oldMessage = createReleaseNotesMessage('2.1.0', 'Notes with a typo')
		const kept = keepValidSignatures({
			message,
			signatures: await signaturesOf(oldMessage),
			rootSignatures: [rootSignatureOf(oldMessage)],
			signingKeys: {keys: [signingKey(alice), signingKey(bob)], rootKey: rootKey.publicKey},
		})
		expect(kept).toEqual({signatures: [], rootSignatures: []})
	})
})

// So what a signer reviews in their terminal is what they sign
describe('readRelease()', () => {
	// A release's files with a byte order mark, which devices read as part of the text
	const files: Record<string, string> = {
		'manifest.txt': `\ufeff${createManifest('2.1.0')}`,
		'release-notes.md': '\ufeff## Notes\n',
		'manifest.txt.sig': '\ufeff--- umbrelOS Signatures ---\n',
	}
	let server: http.Server
	let url: string

	beforeAll(async () => {
		server = http.createServer((request, response) => {
			const file = files[request.url!.slice('/release/'.length)]
			response.writeHead(file === undefined ? 404 : 200).end(file)
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		url = `http://127.0.0.1:${(server.address() as {port: number}).port}/release`
	})

	afterAll(() => new Promise((resolve) => server.close(resolve)))

	// So what's signed and verified is what devices read, which they'd refuse with a byte order mark
	test('reads files from a URL as devices do', async () => {
		expect(await readRelease(url)).toEqual({
			manifest: files['manifest.txt'],
			releaseNotes: files['release-notes.md'],
			signatureFiles: {'manifest.txt.sig': files['manifest.txt.sig'], 'release-notes.md.sig': undefined},
		})
	})
})

// What a signer confirms, after seeing what sign would sign
describe('confirmationCode()', () => {
	const parts = [
		{file: 'manifest.txt.sig', message: '--- umbrelOS Manifest ---\nVersion: 2.1.0'},
		{file: 'release-notes.md.sig', message: '--- umbrelOS Release Notes ---\nVersion: 2.1.0\n\nNotes'},
	]

	test('is the same for the same messages', () => {
		expect(confirmationCode(parts)).toBe(confirmationCode(structuredClone(parts)))
		expect(confirmationCode(parts)).toMatch(/^[0-9a-f]{64}$/)
	})

	test('changes with any message, which file it is for, or which files are signed', () => {
		const code = confirmationCode(parts)
		for (const changed of [
			[{...parts[0], message: `${parts[0].message} `}, parts[1]],
			[parts[0], {...parts[1], message: parts[1].message.replace('Notes', 'notes')}],
			[
				{...parts[0], file: 'release-notes.md.sig'},
				{...parts[1], file: 'manifest.txt.sig'},
			],
			[parts[1]],
			[parts[1], parts[0]],
		]) {
			expect(confirmationCode(changed), JSON.stringify(changed)).not.toBe(code)
		}
	})
})

// The commands sign prints for the signer or their agent to run
describe('shellQuote()', () => {
	test('leaves plain arguments as they are', () => {
		for (const argument of ['https://download.umbrel.com/release/2.1.0/', './release', 'notes.md', '/tmp/a-b_c.d']) {
			expect(shellQuote(argument)).toBe(argument)
		}
	})

	test('quotes anything a shell would split or expand', () => {
		expect(shellQuote('/Users/me/My Release')).toBe("'/Users/me/My Release'")
		expect(shellQuote('$(rm -rf ~)')).toBe("'$(rm -rf ~)'")
		expect(shellQuote("it's")).toBe("'it'\\''s'")
	})
})

describe('showHidden()', () => {
	test('shows characters that could hide or rewrite text as escapes', () => {
		expect(showHidden('Visit\u200bhttps://evil.example')).toBe('Visit\\u{200b}https://evil.example')
		expect(showHidden('\x1b[8mhidden\x1b[0m')).toBe('\\u{1b}[8mhidden\\u{1b}[0m')
		expect(showHidden('Reversed \u202etext')).toBe('Reversed \\u{202e}text')
		expect(showHidden('Carriage\r\nreturn')).toBe('Carriage\\u{d}\nreturn')
		expect(showHidden('\ufeffBOM and\u00a0nbsp')).toBe('\\u{feff}BOM and\\u{a0}nbsp')
	})

	test('leaves visible text, spaces, tabs and newlines as they are', () => {
		const text = "## What's new 🎉\n\n- Fotos más rápidas, 写真, Фото, الصور ❤️ 👍🏽 🇬🇧\n\tIndented — “quoted”…"
		expect(showHidden(text)).toBe(text)
	})
})

// The name a release's file has in releases/, like 2.1.0-manifest.txt
const archivedReleaseFileName = (version: string, file: string) => `${version}-${file}`

describe('checkArchivedReleases()', () => {
	const rootKey = createRootKey()
	const bundle = (byte: string, bootFlow: string, arch: string) => ({
		sha256: byte.repeat(32),
		bundle: `sha512-256:${byte.repeat(32)}`,
		bootFlow,
		arch,
	})
	const files = {
		'umbrelos-amd64.update': bundle('01', 'grub', 'amd64'),
		'umbrelos-amd64-legacy.update': bundle('02', 'mender-grub', 'amd64'),
		'umbrelos-pi.update': bundle('03', 'rpi-tryboot', 'arm64'),
	}
	let directory: string
	let alice: SignerKey

	beforeAll(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), 'umbrel-archive-check-test-'))
		alice = await createSigningKey('alice')
	})

	afterAll(async () => {
		await fs.rm(directory, {recursive: true, force: true})
	})

	// An archive holding one release with this manifest and release notes, signed by Alice
	async function archiveOf(manifest: string, releaseNotes = 'Notes') {
		const archive = await fs.mkdtemp(path.join(directory, 'releases-'))
		const signingKeysList = createSigningKeysList({date: '2026-10-22T00:00:00Z', keys: [signingKey(alice)], rootKey})
		const archived = (file: string) =>
			path.join(archive, archivedReleaseFileName(parseReleaseManifest(manifest).version, file))
		await fs.writeFile(archived('manifest.txt'), manifest)
		await fs.writeFile(archived('manifest.txt.ots'), 'proof')
		await fs.writeFile(archived('release-notes.md'), releaseNotes)
		const {manifestSignature, releaseNotesSignature} = await signRelease(manifest, {
			releaseNotes,
			signingKeysList,
			signers: [alice],
		})
		await fs.writeFile(archived('manifest.txt.sig'), manifestSignature)
		await fs.writeFile(archived('release-notes.md.sig'), releaseNotesSignature)
		return archive
	}

	test('passes a release every device can download and install', async () => {
		await checkArchivedReleases(await archiveOf(createManifest('2.1.0', {files})), rootKey.publicKey)
	})

	test('fails release notes too big for devices to download', async () => {
		const archive = await archiveOf(createManifest('2.1.0', {files}), 'x'.repeat(DOWNLOAD_SIZE_LIMIT + 1))
		await expect(checkArchivedReleases(archive, rootKey.publicKey)).rejects.toThrow('too big for devices to download')
	})

	test('fails a release without a bundle for a kind of device in the field', async () => {
		const {'umbrelos-pi.update': _, ...withoutPi} = files
		const archive = await archiveOf(createManifest('2.1.0', {files: withoutPi}))
		await expect(checkArchivedReleases(archive, rootKey.publicKey)).rejects.toThrow('has no bundle for')
	})

	test("fails release notes with a section for a range devices can't read", async () => {
		const archive = await archiveOf(
			createManifest('2.1.0', {files}),
			'Notes\n<!-- umbrelOS from 2.0 or later -->\nMore',
		)
		await expect(checkArchivedReleases(archive, rootKey.publicKey)).rejects.toThrow('has an invalid range')
	})

	test('fails a release whose release notes changed after signing', async () => {
		const archive = await archiveOf(createManifest('2.1.0', {files}))
		await fs.writeFile(path.join(archive, '2.1.0-release-notes.md'), 'Changed')
		await expect(checkArchivedReleases(archive, rootKey.publicKey)).rejects.toThrow(
			"2.1.0-release-notes.md isn't signed: This release has an invalid signature from alice",
		)
	})

	test('fails a release whose manifest changed after signing', async () => {
		const archive = await archiveOf(createManifest('2.1.0', {files}))
		await fs.writeFile(path.join(archive, '2.1.0-manifest.txt'), createManifest('2.1.0', {files, name: 'Changed'}))
		await expect(checkArchivedReleases(archive, rootKey.publicKey)).rejects.toThrow('invalid signature from alice')
	})
})

// The boot flows and architectures of devices running umbrelOS
const devicesInTheField = [
	// Natively flashed amd64 devices
	{bootFlow: 'grub', arch: 'amd64'},
	// amd64 devices first flashed with Mender and since migrated to Rugix
	{bootFlow: 'mender-grub', arch: 'amd64'},
	{bootFlow: 'rpi-tryboot', arch: 'arm64'},
]

// Check every archived release in a directory, which CI runs on each release's pull request: each has its
// manifest, timestamp, release notes and their signatures, is signed by enough approved keys or the root
// key, as are its release notes, is small enough for devices to download, and has an update bundle for
// every kind of device in the field
async function checkArchivedReleases(directory: string, rootPublicKey = ROOT_PUBLIC_KEY) {
	const files = (await fs.readdir(directory)).filter(
		(file) => !['README.md', 'keys', path.basename(PUBLISHED_SIGNING_KEYS_PATH)].includes(file),
	)
	for (const file of files) expect(file).toMatch(/^.+-(manifest\.txt(\.ots|\.sig)?|release-notes\.md(\.sig)?)$/)
	for (const file of files.filter((file) => file.endsWith('-manifest.txt'))) {
		const read = (name: string) => fs.readFile(path.join(directory, name), 'utf8')
		const manifest = await read(file)
		const release = parseReleaseManifest(manifest)
		const archived = (name: string) => archivedReleaseFileName(release.version, name)
		expect(file, `${file} is named after another version`).toBe(archived('manifest.txt'))
		const names = ['manifest.txt', 'manifest.txt.sig', 'release-notes.md', 'release-notes.md.sig']
		for (const name of [...names, 'manifest.txt.ots']) expect(files).toContain(archived(name))
		for (const name of names) {
			const {size} = await fs.stat(path.join(directory, archived(name)))
			expect(size, `${archived(name)} is too big for devices to download`).toBeLessThanOrEqual(DOWNLOAD_SIZE_LIMIT)
		}

		// Its signatures carry everything needed to verify it with the root key
		const manifestSignatures = readSignatureFile(await read(archived('manifest.txt.sig')), rootPublicKey)
		const releaseNotesSignatures = readSignatureFile(await read(archived('release-notes.md.sig')), rootPublicKey)
		expect(
			manifestSignatures.signingKeys,
			`${archived('manifest.txt.sig')} doesn't carry a root-signed list`,
		).toBeDefined()
		const releaseNotes = await read(archived('release-notes.md'))
		const verified = await verifyRelease({
			manifest,
			manifestSignatures,
			releaseNotes,
			releaseNotesSignatures,
			signingKeys: manifestSignatures.signingKeys!,
		})
		expect(verified.version).toBe(release.version)
		expect(
			verified.releaseNotesError,
			`${archived('release-notes.md')} isn't signed: ${verified.releaseNotesError?.message}`,
		).toBeUndefined()
		for (const device of devicesInTheField) {
			expect(findUpdateBundle(release, device), `${file} has no bundle for ${JSON.stringify(device)}`).toBeDefined()
		}
		// Devices skip a section of the release notes whose range they can't read, so a typo would show the
		// general notes instead
		for (const [, range] of releaseNotes.matchAll(/^<!-- umbrelOS from (.+) -->$/gm)) {
			expect(semver.validRange(range), `${archived('release-notes.md')} has an invalid range: ${range}`).toBeTruthy()
		}
	}
}

describe('releases/', () => {
	test('holds the manifest, timestamp, release notes and signatures of each archived release', async () => {
		await checkArchivedReleases(ARCHIVE_DIRECTORY)
	})

	// Devices fetch it from the public repo on GitHub
	test('holds the bundled list once the root key signed it, at a path that never moves', async () => {
		expect(path.relative(path.join(ARCHIVE_DIRECTORY, '..'), PUBLISHED_SIGNING_KEYS_PATH)).toBe(
			'releases/umbrelos-signing-keys.txt',
		)
		const bundled = await fs.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8')
		expect(await fs.readFile(PUBLISHED_SIGNING_KEYS_PATH, 'utf8'), 'Run ./scripts/release-signing sign-keys-list').toBe(
			bundled,
		)
	})
})

describe('releases/keys/', () => {
	test('holds approved signing keys lists the root key signed, named by their date', async () => {
		// Until the root key signs its first list there are none
		for (const file of await fs.readdir(KEYS_ARCHIVE_DIRECTORY).catch(() => [])) {
			const {date} = verifySigningKeysList(await fs.readFile(path.join(KEYS_ARCHIVE_DIRECTORY, file), 'utf8'))
			expect(file, `${file} is named after another date`).toBe(archivedSigningKeysListName(date))
		}
	})

	// The list is unsigned between provisioning or revoking a key and signing it, which the unit test for
	// the bundled list catches
	test('holds the bundled list once the root key signed it', async () => {
		const bundled = await fs.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8')
		const list = (() => {
			try {
				return verifySigningKeysList(bundled)
			} catch {
				return undefined
			}
		})()
		if (!list) return
		const archived = path.join(KEYS_ARCHIVE_DIRECTORY, archivedSigningKeysListName(list.date))
		expect(await fs.readFile(archived, 'utf8').catch(() => undefined), `${archived} is missing`).toBe(bundled)
	})
})
