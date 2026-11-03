import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import {
	BUNDLED_SIGNING_KEYS_PATH,
	ReleaseVerificationError,
	findUpdateBundle,
	findUpdateScript,
	selectReleaseNotes,
	formatManifestMessage,
	formatReleaseNotesMessage,
	formatSignatureFile,
	formatSigningKeysList,
	newestSigningKeysList,
	parseReleaseManifest,
	parseSigningKeysList,
	readSignatureFile,
	readText,
	releaseDirectoryUrl,
	verifySignerSignature,
	verifyBitcoinMessage,
	verifyRelease,
	verifySigningKeysList,
	type ReleaseFile,
	type ReleaseSignature,
	type SigningKey,
} from './release-signing.ts'
import {
	createManifest,
	createReleaseNotesMessage,
	createRootKey,
	createRootKeyHandover,
	createSigningKeysList,
	createSigningKey,
	secureEnclaveSignatureVector,
	signBitcoinMessage,
	rootSignatureLine,
	signatureLine,
	signerSign,
	type RootKey,
	type SignerKey,
} from '../test-utilities/release-signing.ts'

let directory: string

beforeAll(async () => {
	directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-release-signing-test-'))
})

afterAll(async () => {
	await fse.remove(directory)
})

describe('verifyBitcoinMessage()', () => {
	// A real-world BIP137 signature (from bitcoinjs-message), checking compatibility with other signers
	const publicKey = '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd'
	const message = 'This is an example of a signed message.'
	const signature = 'H9L5yLFjti0QTHhPyFrZCT1V/MMnBtXKmoiKDZ78NDBjERki6ZTQZdSMCtkgoNmp17By9ItJr8o7ChX0XxY91nk='

	test('accepts a signature from the key', () => {
		expect(verifyBitcoinMessage(message, signature, publicKey)).toBe(true)
	})

	test('rejects a different message', () => {
		expect(verifyBitcoinMessage(`${message} `, signature, publicKey)).toBe(false)
	})

	test('rejects a different key', () => {
		expect(verifyBitcoinMessage(message, signature, createRootKey().publicKey)).toBe(false)
	})

	test('rejects malformed signatures and keys', () => {
		expect(verifyBitcoinMessage(message, signature.slice(4), publicKey)).toBe(false)
		expect(verifyBitcoinMessage(message, `${signature}\n`, publicKey)).toBe(false)
		expect(verifyBitcoinMessage(message, 'not a signature', publicKey)).toBe(false)
		expect(verifyBitcoinMessage(message, signature, 'not a key')).toBe(false)
	})

	test('hashes messages longer than 252 bytes with a multi-byte length', () => {
		const rootKey = createRootKey()
		const longMessage = 'x'.repeat(1000)
		expect(
			verifyBitcoinMessage(longMessage, signBitcoinMessage(longMessage, rootKey.privateKey), rootKey.publicKey),
		).toBe(true)
	})
})

describe('verifySigningKeysList()', () => {
	const rootKey = createRootKey()
	const date = '2026-10-22T17:45:23Z'
	const keys = [
		{name: 'alice-mbp-2026', publicKey: '026935f7c9f454e1d2be6168a78fe99b877468031d5fd2a4f0c5c0cd486d743cee'},
		{name: 'bob-mbp-2025', publicKey: '032894441bab04a7d13067b4f71c168f1f341507d86c1ffdc344102eaa516c0c30'},
	]

	// A list with each message line changed, signed by the root key
	const signedList = (change: (lines: string[]) => string[]) => {
		const [message] = createSigningKeysList({date, keys, rootKey}).split('\nRoot-Signature: ')
		const changed = change(message.split('\n')).join('\n')
		return `${changed}\nRoot-Signature: ${signBitcoinMessage(changed, rootKey.privateKey)}\n`
	}

	test('parses a list signed by the root key', () => {
		const text = createSigningKeysList({date, keys, rootKey})
		expect(verifySigningKeysList(text, rootKey.publicKey)).toEqual({
			date: new Date(date),
			requiredSignatures: 1,
			keys,
			revokedReleases: [],
			handovers: [],
			rootKey: rootKey.publicKey,
			text,
		})
	})

	// Like a source or a cache in front of it adding a line, so the list is saved and carried as it was signed
	test('leaves out lines outside its blocks', () => {
		const text = createSigningKeysList({date, keys, rootKey})
		for (const padded of [`Approved keys\n${text}`, `${text}\n<!-- cached -->\n`]) {
			const list = verifySigningKeysList(padded, rootKey.publicKey)
			expect(list.text).toBe(text)
			expect(() => formatSignatureFile({signingKeysList: list.text, signatures: []})).not.toThrow()
		}
	})

	// By the hash of each one's manifest, labelled for people with its version or anything else
	test('parses the releases it revokes', () => {
		const revokedReleases = [{manifest: 'ab'.repeat(32), label: '2.1.0'}, {manifest: 'cd'.repeat(32)}]
		const text = createSigningKeysList({date, keys, revokedReleases, rootKey})
		expect(verifySigningKeysList(text, rootKey.publicKey).revokedReleases).toEqual(revokedReleases)
		expect(text).toContain(
			`\nRevoked-Release: sha256:${'ab'.repeat(32)} 2.1.0\nRevoked-Release: sha256:${'cd'.repeat(32)}\nRoot-Signature: `,
		)
	})

	// A device saves the list as it came, so padding it with signatures would slow every check after
	test('checks at most 32 root signatures however many the list has', () => {
		const [message] = createSigningKeysList({date, keys, rootKey}).split('\nRoot-Signature: ')
		const invalid = `Root-Signature: ${signBitcoinMessage('Not the list', rootKey.privateKey)}\n`
		const valid = `Root-Signature: ${signBitcoinMessage(message, rootKey.privateKey)}\n`
		const padded = (count: number) => `${message}\n${invalid.repeat(count)}${valid}`
		const started = Date.now()
		expect(() => verifySigningKeysList(padded(10_000), rootKey.publicKey)).toThrow('not signed by the root key')
		expect(Date.now() - started).toBeLessThan(1000)
		expect(verifySigningKeysList(padded(31), rootKey.publicKey).date).toEqual(new Date(date))
	})

	test('parses how many signatures releases need', () => {
		const text = createSigningKeysList({date, requiredSignatures: 2, keys, rootKey})
		expect(verifySigningKeysList(text, rootKey.publicKey).requiredSignatures).toBe(2)
	})

	test('accepts a list that revokes every key', () => {
		const text = createSigningKeysList({date, keys: [], rootKey})
		expect(verifySigningKeysList(text, rootKey.publicKey).keys).toEqual([])
	})

	test('rejects a list signed by another key', () => {
		const text = createSigningKeysList({date, keys, rootKey: createRootKey()})
		expect(() => verifySigningKeysList(text, rootKey.publicKey)).toThrow('not signed by the root key')
	})

	test('rejects a list changed after signing', () => {
		const text = createSigningKeysList({date, keys, rootKey})
		for (const changed of [
			text.replace(
				'\nRoot-Signature:',
				`\nKey: mallory-mbp ${createSigningKey('mallory-mbp').publicKey}\nRoot-Signature:`,
			),
			text.replace('Required-Signatures: 1', 'Required-Signatures: 2'),
			text.replace(date, '2026-10-22T17:45:24Z'),
		]) {
			expect(() => verifySigningKeysList(changed, rootKey.publicKey)).toThrow('not signed by the root key')
		}
	})

	test('rejects a list without a signature', () => {
		const text = createSigningKeysList({date, keys, rootKey})
		expect(() => verifySigningKeysList(text.replace(/Root-Signature: .*\n$/, ''), rootKey.publicKey)).toThrow(
			'not signed by the root key',
		)

		// Like one waiting for the root key to sign it
		const unsigned = formatSigningKeysList({date: new Date(date), requiredSignatures: 1, keys, rootSignatures: []})
		expect(parseSigningKeysList(unsigned)).toMatchObject({keys, rootSignatures: []})
		expect(() => verifySigningKeysList(unsigned, rootKey.publicKey)).toThrow('not signed by the root key')
	})

	// Like a co-signer's, if the root key ever becomes several keys
	test("accepts a list with other root signatures alongside the root key's", () => {
		const text = createSigningKeysList({date, keys, rootKey})
		const withOthers = text.replace(/\n$/, `\nRoot-Signature: ${signBitcoinMessage('x', createRootKey().privateKey)}\n`)
		expect(verifySigningKeysList(withOthers, rootKey.publicKey).keys).toEqual(keys)
	})

	test('formats lists the way they are signed', () => {
		const text = createSigningKeysList({date, requiredSignatures: 2, keys, rootKey})
		const {rootSignatures} = parseSigningKeysList(text)
		expect(formatSigningKeysList({date: new Date(date), requiredSignatures: 2, keys, rootSignatures})).toBe(text)
	})

	// Devices in the field keep the parser they shipped with, so lists can gain fields they ignore
	test('ignores fields, lines, key details and blocks it does not know', () => {
		const text = signedList((lines) => [
			...lines.slice(0, 4),
			'Comment: Approves Carol',
			'reviewed-by: alice',
			'Note:',
			'not a field',
			...lines.slice(4).map((line) => `${line} expires=2027-01-01`),
			// Keys this can't read, like another kind of key or a point that isn't on the curve
			'Key: carol SHA256:2f3LdD5gDw7rZCFsc2RBk01SlHgYrEenlTAI9FOZDPo',
			'Key: dave *',
			`Key: erin 02${'00'.repeat(31)}01`,
			`Key: frank 04${'ab'.repeat(32)}`,
			`Key: grace ${keys[0].publicKey.toUpperCase()}`,
			`Revoked-Release: sha256:${'ab'.repeat(32)} 2.1.0, which breaks Pi 4s`,
		])
		const withOtherBlocks = `Approved keys\n${text}\n--- Something Later ---\nSchema: 2\n`
		expect(verifySigningKeysList(withOtherBlocks, rootKey.publicKey)).toMatchObject({
			keys,
			requiredSignatures: 1,
			revokedReleases: [{manifest: 'ab'.repeat(32), label: '2.1.0, which breaks Pi 4s'}],
		})
	})

	// A change older devices mustn't ignore goes in a block with a new header instead
	test('ignores the schema, which is a hint for later parsers', () => {
		const expected = verifySigningKeysList(
			signedList((lines) => lines),
			rootKey.publicKey,
		)
		for (const text of [
			signedList((lines) => lines.map((line) => line.replace('Schema: 1', 'Schema: 2'))),
			signedList((lines) => lines.filter((line) => line !== 'Schema: 1')),
			signedList(([header, schema, ...rest]) => [header, ...rest, schema]),
		]) {
			expect(verifySigningKeysList(text, rootKey.publicKey), text).toMatchObject({
				date: expected.date,
				keys: expected.keys,
				requiredSignatures: expected.requiredSignatures,
			})
		}
	})

	// Like ones by another kind of hash, so a later list using them still counts on this release
	test("ignores revoked releases it can't read, keeping the rest of the list", () => {
		const readable = `Revoked-Release: sha256:${'cd'.repeat(32)} 2.1.0`
		for (const revoked of [
			'2.1.0',
			`sha256:${'AB'.repeat(32)}`,
			`sha256:${'ab'.repeat(31)}`,
			'ab'.repeat(32),
			`blake3:${'ab'.repeat(32)}`,
		]) {
			const list = verifySigningKeysList(
				signedList((lines) => [...lines, `Revoked-Release: ${revoked}`, readable]),
				rootKey.publicKey,
			)
			expect(list.keys, revoked).toEqual(keys)
			expect(list.revokedReleases, revoked).toEqual([{manifest: 'cd'.repeat(32), label: '2.1.0'}])
		}
	})

	test('rejects signed lists with invalid contents', () => {
		const verify = (change: (lines: string[]) => string[]) => () =>
			verifySigningKeysList(signedList(change), rootKey.publicKey)
		const replace = (from: string, to: string) => verify((lines) => lines.map((line) => line.replace(from, to)))

		expect(replace('--- umbrelOS Signing Keys ---', '--- Keys ---')).toThrow('invalid header')
		expect(replace(date, '2026-02-30T00:00:00Z')).toThrow('invalid date')
		expect(replace(date, '2026-10-22 17:45:23')).toThrow('invalid date')
		expect(verify((lines) => lines.filter((line) => !line.startsWith('Date:')))).toThrow('invalid date')
		expect(verify((lines) => [...lines, `Date: ${date}`])).toThrow('invalid date')
		for (const count of ['0', '-1', 'two', '1.5', '']) {
			expect(replace('Required-Signatures: 1', `Required-Signatures: ${count}`)).toThrow('invalid required-signatures')
		}
		expect(verify((lines) => lines.filter((line) => !line.startsWith('Required-Signatures:')))).toThrow(
			'invalid required-signatures',
		)
		expect(verify((lines) => [...lines, lines.at(-1)!])).toThrow('duplicate keys')
		expect(verify((lines) => [...lines, lines.at(-1)!.replace('bob-mbp-2025', 'bob')])).toThrow('duplicate keys')
		// Its signature isn't part of the list once a blank line ends it
		expect(verify((lines) => [...lines, ''])).toThrow('not signed by the root key')
		expect(verify(([header, ...rest]) => [`${header} `, ...rest])).toThrow('invalid header')
	})

	// Provisioning or revoking a signer leaves the bundled list unsigned, so this fails until the root key
	// signs it
	test('the bundled list is signed by the root key', async () => {
		const text = await fse.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8')
		try {
			expect(verifySigningKeysList(text).keys.length).toBeGreaterThan(0)
		} catch (error) {
			throw new Error(
				`${path.basename(BUNDLED_SIGNING_KEYS_PATH)} needs signing with the root key: run ./scripts/release-signing sign-keys-list (${(error as Error).message})`,
			)
		}
	})
})

// The root key can move to a new hardware wallet: it signs a handover to the new key, which signs lists
// from then on. Handovers chain, so it can move again.
describe('root key handovers', () => {
	const [first, second, third, other] = [createRootKey(), createRootKey(), createRootKey(), createRootKey()]
	const keys = [
		{name: 'alice-mbp-2026', publicKey: '026935f7c9f454e1d2be6168a78fe99b877468031d5fd2a4f0c5c0cd486d743cee'},
	]
	const firstToSecond = createRootKeyHandover({date: '2027-01-01T00:00:00Z', from: first, to: second})
	const secondToThird = createRootKeyHandover({date: '2028-01-01T00:00:00Z', from: second, to: third})
	const list = (rootKey: RootKey, handovers: string[], date = '2028-06-01T00:00:00Z') =>
		createSigningKeysList({date, keys, rootKey, handovers})
	const verify = (text: string) => verifySigningKeysList(text, first.publicKey)
	// A handover from one key to another that the key it hands over from never signed
	const unsignedHandover = (from: RootKey, to: RootKey) =>
		createRootKeyHandover({date: '2029-01-01T00:00:00Z', from, to}).replace(
			/^Root-Signature: .*$/m,
			`Root-Signature: ${signBitcoinMessage('x', to.privateKey)}`,
		)

	test('accepts a list signed by the root key a handover moved to', () => {
		const verified = verify(list(second, [firstToSecond]))
		expect(verified.rootKey).toBe(second.publicKey)
		expect(verified.handovers).toMatchObject([
			{date: new Date('2027-01-01T00:00:00Z'), from: first.publicKey, to: second.publicKey},
		])
		expect(verified.keys).toEqual(keys)
	})

	test('follows a chain of handovers', () => {
		expect(verify(list(third, [firstToSecond, secondToThird])).rootKey).toBe(third.publicKey)
	})

	test('rejects a list signed by a root key it handed over from', () => {
		for (const text of [list(first, [firstToSecond]), list(second, [firstToSecond, secondToThird])]) {
			expect(() => verify(text)).toThrow('not signed by the root key')
		}
	})

	test('rejects handovers not signed by the root key they hand over from', () => {
		const forged = createRootKeyHandover({date: '2027-01-01T00:00:00Z', from: first, to: other}).replace(
			/^Root-Signature: .*$/m,
			`Root-Signature: ${signBitcoinMessage('x', other.privateKey)}`,
		)
		expect(() => verify(list(other, [forged]))).toThrow('not signed by the root key it hands over from')
	})

	test('rejects handovers out of order', () => {
		// One that doesn't start from the root key at the end of the chain so far
		const fromFirstAgain = createRootKeyHandover({date: '2028-01-01T00:00:00Z', from: first, to: third})
		expect(() => verify(list(third, [firstToSecond, fromFirstAgain]))).toThrow('out of order')
		// One that doesn't start from the release's root key
		expect(() => verify(list(third, [secondToThird]))).toThrow('out of order')
		// Dated before the one before it
		const earlier = createRootKeyHandover({date: '2026-01-01T00:00:00Z', from: second, to: third})
		expect(() => verify(list(third, [firstToSecond, earlier]))).toThrow('out of order')
	})

	test('rejects malformed handovers', () => {
		for (const handover of [
			firstToSecond.replace(`To: ${second.publicKey}`, 'To: not a key'),
			firstToSecond.replace(`To: ${second.publicKey}`, `To: ${first.publicKey}`),
			firstToSecond.replace('Schema: 1', 'Schema: 2'),
			firstToSecond.replace(/Root-Signature: .*\n$/, ''),
		]) {
			expect(() => verify(list(second, [handover])), handover).toThrow()
		}
	})

	test('follows handovers past blocks it does not know', () => {
		const text = list(third, [firstToSecond, `--- Something Later ---\nSchema: 2\n`, secondToThird])
		expect(verify(text).rootKey).toBe(third.publicKey)
	})

	// Whoever has a retired root key can copy the real handovers into a list they sign, and add their own
	describe('a retired root key', () => {
		test("can't get back in with a fake handover to it", () => {
			const fake = unsignedHandover(other, first)
			for (const handovers of [
				[firstToSecond, fake],
				[firstToSecond, secondToThird, fake],
				[fake, firstToSecond],
				[fake],
			]) {
				expect(() => verify(list(first, handovers))).toThrow('out of order')
			}
		})

		test("can't hand over again with a fake handover from it", () => {
			const fake = unsignedHandover(first, other)
			expect(() => verify(list(other, [fake, firstToSecond]))).toThrow('not signed by the root key it hands over from')
		})

		// A device that has seen it handed over only takes lists that continue the chain from it
		test("can't replace the list of a device that has seen it handed over", () => {
			const handedOver = verify(list(second, [firstToSecond], '2027-06-01T00:00:00Z'))
			const firstToOther = createRootKeyHandover({date: '2027-02-01T00:00:00Z', from: first, to: other})
			expect(newestSigningKeysList([handedOver, verify(list(other, [firstToOther], '2030-01-01T00:00:00Z'))])).toBe(
				handedOver,
			)
			// Or by copying the handover with where it comes from changed, so a chain could start after it
			const rewritten = firstToSecond.replace(`From: ${first.publicKey}`, `From: ${other.publicKey}`)
			expect(() => verify(list(other, [rewritten, firstToOther], '2030-01-01T00:00:00Z'))).toThrow('out of order')
		})

		// Once the root key was handed back, an older handover from it is still validly signed
		test("can't replay a handover from before the root key was handed back to it", () => {
			const secondToFirst = createRootKeyHandover({date: '2028-01-01T00:00:00Z', from: second, to: first})
			const handedBack = verify(list(first, [firstToSecond, secondToFirst], '2028-06-01T00:00:00Z'))
			const secondToOther = createRootKeyHandover({date: '2029-01-01T00:00:00Z', from: second, to: other})
			const replayed = verify(list(other, [firstToSecond, secondToOther], '2030-01-01T00:00:00Z'))
			expect(newestSigningKeysList([handedBack, replayed])).toBe(handedBack)
		})
	})

	// A list's root signature only covers its own block, so anyone serving a list can attach handovers to it
	test("doesn't take a list with a handover attached that isn't part of its chain", () => {
		const junk = unsignedHandover(other, third)
		const current = verify(list(first, [], '2026-01-01T00:00:00Z'))
		for (const handovers of [[junk], [firstToSecond, junk], [junk, firstToSecond]]) {
			const signer = handovers.includes(firstToSecond) ? second : first
			expect(() => verify(list(signer, handovers, '2027-06-01T00:00:00Z'))).toThrow()
		}
		// So later lists, like one revoking a key or handing the root key over, are still taken
		const handedOver = verify(list(second, [firstToSecond], '2027-06-01T00:00:00Z'))
		expect(newestSigningKeysList([current, handedOver])).toBe(handedOver)
	})

	test('follows a chain that hands back to an earlier root key', () => {
		const secondToFirst = createRootKeyHandover({date: '2028-01-01T00:00:00Z', from: second, to: first})
		expect(verify(list(first, [firstToSecond, secondToFirst])).rootKey).toBe(first.publicKey)
		expect(() => verify(list(second, [firstToSecond, secondToFirst]))).toThrow('not signed by the root key')
	})

	test('formats lists with handovers the way they are signed', () => {
		const text = list(third, [firstToSecond, secondToThird])
		const parsed = parseSigningKeysList(text)
		expect(formatSigningKeysList(parsed)).toBe(text)
	})
})

// Rather than particular attacks: every list someone could make from the real handovers, changed copies of
// them and the keys they hold
describe('keys lists from anyone without the root key a device trusts', () => {
	const [k0, k1, k2, attacker] = [createRootKey(), createRootKey(), createRootKey(), createRootKey()]
	const keys = [
		{name: 'alice-mbp-2026', publicKey: '026935f7c9f454e1d2be6168a78fe99b877468031d5fd2a4f0c5c0cd486d743cee'},
	]
	const real = [
		createRootKeyHandover({date: '2027-01-01T00:00:00Z', from: k0, to: k1}),
		createRootKeyHandover({date: '2028-01-01T00:00:00Z', from: k1, to: k2}),
	]
	const list = (rootKey: RootKey, handovers: string[], date: string) =>
		createSigningKeysList({date, keys, rootKey, handovers})
	const verifyOrUndefined = (text: string) => {
		try {
			return verifySigningKeysList(text, k0.publicKey)
		} catch {
			return undefined
		}
	}

	// The handovers someone holding these keys could put in a list: the real ones, their own from the keys
	// they hold, real ones with a field changed or their signature removed, and an unsigned one
	const handoversFrom = (held: RootKey[]) => [
		...real,
		...held.map((key) => createRootKeyHandover({date: '2029-01-01T00:00:00Z', from: key, to: attacker})),
		...real.flatMap((handover) => [
			handover.replace(/^From: .*$/m, `From: ${attacker.publicKey}`),
			handover.replace(/^To: .*$/m, `To: ${attacker.publicKey}`),
			handover.replace(/^Date: .*$/m, 'Date: 2029-06-01T00:00:00Z'),
			handover.replace(/^Root-Signature: .*\n/m, ''),
		]),
		`--- umbrelOS Root Key Handover ---\nSchema: 1\nDate: 2029-01-01T00:00:00Z\nFrom: ${attacker.publicKey}\nTo: ${k0.publicKey}\n`,
	]

	// Every sequence of up to three of them, repeats included
	const sequences = (pool: string[]) => {
		let current: string[][] = [[]]
		const all = [...current]
		for (let length = 1; length <= 3; length++) {
			current = current.flatMap((sequence) => pool.map((handover) => [...sequence, handover]))
			all.push(...current)
		}
		return all
	}

	test("never takes a list whose chain doesn't continue its own", () => {
		// Devices that have seen the first handover, and both
		for (const seen of [1, 2]) {
			const current = verifyOrUndefined(list([k1, k2][seen - 1], real.slice(0, seen), '2028-06-01T00:00:00Z'))!
			// Every root key it has seen handed over, and their own, but never the one it trusts now
			const held = [k0, k1, k2].slice(0, seen)
			for (const handovers of sequences(handoversFrom(held))) {
				for (const signer of [...held, attacker]) {
					const candidate = verifyOrUndefined(list(signer, handovers, '2030-01-01T00:00:00Z'))
					expect(newestSigningKeysList([current, candidate])).toBe(current)
				}
			}
		}
	})

	// Like handovers attached to a genuine newer list, which its root signature doesn't cover
	test('never takes a list that stops it taking later genuine ones', () => {
		const current = verifyOrUndefined(list(k0, [], '2026-01-01T00:00:00Z'))!
		const later = verifyOrUndefined(list(k2, real, '2031-01-01T00:00:00Z'))!
		for (const handovers of sequences(handoversFrom([k0, k1]))) {
			for (const signer of [k0, k1, k2]) {
				const taken = newestSigningKeysList([
					current,
					verifyOrUndefined(list(signer, handovers, '2029-01-01T00:00:00Z')),
				])!
				expect(newestSigningKeysList([taken, later])).toBe(later)
			}
		}
	})
})

describe('newestSigningKeysList()', () => {
	const [first, second, other] = [createRootKey(), createRootKey(), createRootKey()]
	const keys = [
		{name: 'alice-mbp-2026', publicKey: '026935f7c9f454e1d2be6168a78fe99b877468031d5fd2a4f0c5c0cd486d743cee'},
	]
	const handover = createRootKeyHandover({date: '2027-01-01T00:00:00Z', from: first, to: second})
	const list = (date: string, rootKey = first, handovers: string[] = []) =>
		verifySigningKeysList(createSigningKeysList({date, keys, rootKey, handovers}), first.publicKey)

	test('picks the most recently dated list, preferring the first on a tie', () => {
		const [older, newer, sameDate] = [
			list('2026-01-01T00:00:00Z'),
			list('2026-02-01T00:00:00Z'),
			list('2026-02-01T00:00:00Z'),
		]
		expect(newestSigningKeysList([older, undefined, newer])).toBe(newer)
		expect(newestSigningKeysList([newer, older])).toBe(newer)
		expect(newestSigningKeysList([newer, sameDate])).toBe(newer)
	})

	test('picks a later list that hands the root key over', () => {
		const handedOver = list('2027-01-02T00:00:00Z', second, [handover])
		expect(newestSigningKeysList([list('2026-12-01T00:00:00Z'), handedOver])).toBe(handedOver)
	})

	// So whoever has a retired root key can't undo the handover for a device that has seen it
	test("never replaces a list with a later one that doesn't continue its handovers", () => {
		const handedOver = list('2027-01-02T00:00:00Z', second, [handover])
		const fromRetiredRoot = list('2030-01-01T00:00:00Z')
		const otherHandover = list('2030-01-01T00:00:00Z', other, [
			createRootKeyHandover({date: '2029-01-01T00:00:00Z', from: first, to: other}),
		])
		expect(newestSigningKeysList([handedOver, fromRetiredRoot, otherHandover])).toBe(handedOver)
	})

	// Two sources serving different handovers means a retired root key signed one, so neither is trusted
	// whichever source answers first
	// Like any other lists, so a device that hasn't seen the real handover can be fooled by the retired key
	test('picks the most recently dated of lists that hand the root key over to different keys', () => {
		const current = list('2026-12-01T00:00:00Z')
		const handedOver = list('2027-01-02T00:00:00Z', second, [handover])
		const otherHandover = list('2027-01-03T00:00:00Z', other, [
			createRootKeyHandover({date: '2026-12-31T00:00:00Z', from: first, to: other}),
		])
		expect(newestSigningKeysList([current, otherHandover, handedOver])).toBe(otherHandover)
		expect(newestSigningKeysList([current, handedOver, otherHandover])).toBe(otherHandover)
	})

	// A device that took one before seeing the handover keeps it, as nothing tells the two apart
	test('keeps a later list from the retired root key it took before seeing the handover', () => {
		const handedOver = list('2027-01-02T00:00:00Z', second, [handover])
		const fromRetiredRoot = list('2030-01-01T00:00:00Z')
		expect(newestSigningKeysList([fromRetiredRoot, handedOver])).toBe(fromRetiredRoot)
	})
})

describe('parseReleaseManifest()', () => {
	test('parses the version, name, date and files', () => {
		expect(parseReleaseManifest(createManifest('2.1.0', {name: 'umbrelOS 2.1'}))).toEqual({
			version: '2.1.0',
			name: 'umbrelOS 2.1',
			date: new Date('2026-11-04T12:00:00Z'),
			files: {
				'umbrelos-amd64.img.xz': {sha256: 'cd'.repeat(32)},
				'umbrelos-amd64.update': {
					sha256: 'ef'.repeat(32),
					bundle: `sha512-256:${'ab'.repeat(32)}`,
					bootFlow: 'grub',
					arch: 'amd64',
				},
			},
		})
	})

	test('parses update scripts', () => {
		const manifest = createManifest('2.1.0', {
			files: {
				'update.sh': {sha256: '12'.repeat(32), type: 'update-script'},
				'update-pi.sh': {sha256: '34'.repeat(32), type: 'update-script', bootFlow: 'rpi-tryboot', arch: 'arm64'},
			},
		})
		expect(parseReleaseManifest(manifest).files).toEqual({
			'update.sh': {sha256: '12'.repeat(32), type: 'update-script'},
			'update-pi.sh': {sha256: '34'.repeat(32), type: 'update-script', bootFlow: 'rpi-tryboot', arch: 'arm64'},
		})
	})

	test('parses the Docker image, ignoring one that is not by its digest', () => {
		const dockerImage = `ghcr.io/getumbrel/umbrelos@sha256:${'cd'.repeat(32)}`
		expect(parseReleaseManifest(createManifest('2.1.0', {dockerImage})).dockerImage).toBe(dockerImage)
		const byTag = parseReleaseManifest(createManifest('2.1.0', {dockerImage: 'ghcr.io/getumbrel/umbrelos:2.1.0'}))
		expect(byTag).not.toHaveProperty('dockerImage')
		expect(() =>
			parseReleaseManifest(
				createManifest('2.1.0', {dockerImage}).replace('Docker-Image', 'Docker-Image: x\nDocker-Image'),
			),
		).toThrow('invalid docker-image')
	})

	// Devices in the field keep the parser they shipped with, so manifests can gain fields they ignore
	test('ignores fields and file details it does not know', () => {
		const sha256 = `sha256:${'00'.repeat(32)}`
		const manifest = createManifest('2.1.0')
			.replace('Version: 2.1.0', 'Version: 2.1.0\nChannel: stable\nminimum-version: 2.0.0\nNote:')
			.replace(`sha256:${'cd'.repeat(32)}`, `sha256:${'cd'.repeat(32)} size:1024 mirror=https://example.com`)
			.concat(
				[
					// Files this can't read, which it leaves out
					`File: extras/tools.tar ${sha256}`,
					`File: umbrelos-pi.update bundle:sha512-256:${'ab'.repeat(32)}`,
					`File: umbrelos-pi5.update ${sha256} bundle:nope`,
					`File: umbrelos-arm64.update sha256:short`,
					`File: umbrelos-arm64.update ${sha256} boot-flow:Grub`,
					`File: update.sh ${sha256} type:update_script`,
					'not a field',
					'',
				].join('\n') + '\n',
			)
		expect(parseReleaseManifest(manifest)).toEqual(parseReleaseManifest(createManifest('2.1.0')))
	})

	test('ignores the schema, which is a hint for later parsers', () => {
		const manifest = createManifest('2.1.0')
		for (const otherManifest of [
			manifest.replace('Schema: 1', 'Schema: 2'),
			manifest.replace('Schema: 1\n', ''),
			manifest.replace('Schema: 1\n', '').replace('Version: 2.1.0', 'Version: 2.1.0\nSchema: 1'),
		]) {
			expect(parseReleaseManifest(otherManifest), otherManifest).toEqual(parseReleaseManifest(manifest))
		}
	})

	test('rejects malformed manifests', () => {
		const manifest = createManifest('2.1.0')
		const bundleFile = `File: umbrelos-pi.update sha256:${'00'.repeat(32)}`
		for (const badManifest of [
			manifest.replace('--- umbrelOS Manifest ---', '--- umbrelOS Release ---'),
			manifest.replace('Version: 2.1.0', 'Version: v2.1.0'),
			manifest.replace('Version: 2.1.0', 'Version: 2.1.0\nVersion: 2.1.1'),
			manifest.replace('Version: 2.1.0\n', ''),
			manifest.replace('Name: umbrelOS 2.1.0\n', ''),
			manifest.replace('Name: umbrelOS 2.1.0', 'Name: '),
			manifest.replace('Name: umbrelOS 2.1.0', 'Name:  umbrelOS'),
			manifest.replace('Date: 2026-11-04T12:00:00Z\n', ''),
			manifest.replace('Date: 2026-11-04T12:00:00Z', 'Date: 2026-02-30T12:00:00Z'),
			manifest.replace('Date: 2026-11-04T12:00:00Z', 'Date: 4 November 2026'),
			// Files it could read more than one way
			`${manifest}File: umbrelos-amd64.update sha256:${'00'.repeat(32)}\n`,
			`${manifest}${bundleFile} sha256:${'11'.repeat(32)}\n`,
			`${manifest}${bundleFile} bundle:sha512-256:${'ab'.repeat(32)} bundle:sha512-256:${'ba'.repeat(32)}\n`,
			`${manifest}${bundleFile} boot-flow:rpi-tryboot boot-flow:grub\n`,
			`${manifest}${bundleFile} arch:arm64 arch:amd64\n`,
			`${manifest}File: update.sh sha256:${'00'.repeat(32)} type:update-script type:other\n`,
			manifest.replace(/\n$/, ''),
		]) {
			expect(() => parseReleaseManifest(badManifest), badManifest).toThrow(ReleaseVerificationError)
		}
	})
})

describe('selectReleaseNotes()', () => {
	const releaseNotes = [
		'General notes',
		'',
		"### What's new",
		'',
		'<!-- umbrelOS from 2.0.x -->',
		'',
		'Notes for 2.0',
		'',
		'<!-- umbrelOS from >=1.4.1 <1.5.0 -->',
		'Notes since 1.4.1',
		'<!-- umbrelOS from 2.0.1 -->',
		'Never shown, as 2.0.x comes first',
		'<!-- umbrelOS from a later kind of selector -->',
		'Left for later versions',
		'',
	].join('\n')

	test.each([
		['2.0.0', 'Notes for 2.0'],
		['2.0.1', 'Notes for 2.0'],
		['1.4.1', 'Notes since 1.4.1'],
		['1.4.9', 'Notes since 1.4.1'],
		['1.5.0', "General notes\n\n### What's new"],
		['2.1.0-beta.1', "General notes\n\n### What's new"],
	])('shows a device on %s its section, or the general notes', (installedVersion, shown) => {
		expect(selectReleaseNotes(releaseNotes, installedVersion)).toBe(shown)
	})

	test('shows notes without sections as they are', () => {
		expect(selectReleaseNotes("## What's new\n\n- Faster\n", '2.0.0')).toBe("## What's new\n\n- Faster")
		expect(selectReleaseNotes('', '2.0.0')).toBe('')
	})

	test('matches prereleases too', () => {
		expect(selectReleaseNotes('General\n<!-- umbrelOS from >=2.1.0-beta.0 <2.1.0 -->\nFor betas', '2.1.0-beta.2')).toBe(
			'For betas',
		)
	})
})

describe('findUpdateBundle()', () => {
	const bundle = (byte: string, details: Partial<ReleaseFile>): ReleaseFile => ({
		sha256: 'ef'.repeat(32),
		bundle: `sha512-256:${byte.repeat(32)}`,
		...details,
	})
	const release = parseReleaseManifest(
		createManifest('2.1.0', {
			files: {
				'umbrelos-amd64.img.xz': {sha256: 'cd'.repeat(32), bootFlow: 'grub', arch: 'amd64'},
				'umbrelos-amd64.update': bundle('01', {bootFlow: 'grub', arch: 'amd64'}),
				// Like a bundle for one kind of hardware, which a later version could prefer
				'umbrelos-amd64-special.update': bundle('02', {bootFlow: 'grub', arch: 'amd64'}),
				'umbrelos-amd64-legacy.update': bundle('03', {bootFlow: 'mender-grub', arch: 'amd64'}),
				'umbrelos-amd64-legacy-migration.update': bundle('04', {}),
				'umbrelos-pi.update': bundle('05', {bootFlow: 'rpi-tryboot', arch: 'arm64'}),
				'umbrelos-arm64.update': bundle('06', {bootFlow: 'grub', arch: 'arm64'}),
			},
		}),
	)

	test.each([
		['grub', 'amd64', 'umbrelos-amd64.update', '01'],
		['mender-grub', 'amd64', 'umbrelos-amd64-legacy.update', '03'],
		['rpi-tryboot', 'arm64', 'umbrelos-pi.update', '05'],
		['grub', 'arm64', 'umbrelos-arm64.update', '06'],
	])('picks the first bundle for a %s %s device', (bootFlow, arch, name, byte) => {
		expect(findUpdateBundle(release, {bootFlow, arch})).toEqual({name, bundleHash: `sha512-256:${byte.repeat(32)}`})
	})

	test.each([
		['u-boot', 'arm64'],
		['rpi-tryboot', 'amd64'],
		[undefined, 'amd64'],
	])('finds none for a %s %s device', (bootFlow, arch) => {
		expect(findUpdateBundle(release, {bootFlow, arch})).toBeUndefined()
	})
})

describe('findUpdateScript()', () => {
	const script = (byte: string, details: Partial<ReleaseFile> = {}): ReleaseFile => ({
		sha256: byte.repeat(32),
		type: 'update-script',
		...details,
	})

	test("picks the first update script for the device's boot flow and architecture", () => {
		const release = parseReleaseManifest(
			createManifest('2.1.0', {
				files: {
					'update.txt': {sha256: '00'.repeat(32)},
					'update-pi.sh': script('01', {bootFlow: 'rpi-tryboot'}),
					'update-arm64.sh': script('02', {arch: 'arm64'}),
					'update.sh': script('03'),
					'update-grub.sh': script('04', {bootFlow: 'grub', arch: 'amd64'}),
				},
			}),
		)
		expect(findUpdateScript(release, {bootFlow: 'rpi-tryboot', arch: 'arm64'})?.name).toBe('update-pi.sh')
		expect(findUpdateScript(release, {bootFlow: 'grub', arch: 'arm64'})?.name).toBe('update-arm64.sh')
		expect(findUpdateScript(release, {bootFlow: 'grub', arch: 'amd64'})).toEqual({
			name: 'update.sh',
			sha256: '03'.repeat(32),
		})
	})

	test('finds none in a release without one for the device', () => {
		const release = parseReleaseManifest(
			createManifest('2.1.0', {files: {'update-pi.sh': script('01', {bootFlow: 'rpi-tryboot'})}}),
		)
		expect(findUpdateScript(release, {bootFlow: 'grub', arch: 'amd64'})).toBeUndefined()
		expect(findUpdateScript(parseReleaseManifest(createManifest('2.1.0')), {arch: 'amd64'})).toBeUndefined()
	})
})

describe('readText()', () => {
	test('reads a response up to the limit', async () => {
		await expect(readText(new Response('x'.repeat(1000)), 1000)).resolves.toBe('x'.repeat(1000))
		await expect(readText(new Response('x'.repeat(1001)), 1000)).rejects.toThrow('is over 1000 bytes')
	})
})

describe('releaseDirectoryUrl()', () => {
	test("finds a release's directory from a URL for it", () => {
		expect(releaseDirectoryUrl('https://download.umbrel.com/public-test-build')).toBe(
			'https://download.umbrel.com/public-test-build/',
		)
		for (const file of ['manifest.txt', 'manifest.txt.sig', 'release-notes.md', 'release-notes.md.sig']) {
			expect(releaseDirectoryUrl(`https://download.umbrel.com/release/2.1.0/${file}?x=1#y`)).toBe(
				'https://download.umbrel.com/release/2.1.0/',
			)
		}
	})

	// The update server picks the URL, and the error is shown to the user
	test("doesn't repeat a URL it refuses", () => {
		const url = 'data:Your Umbrel is compromised, call +1 555 0100 now'
		expect(() => releaseDirectoryUrl(url)).toThrow(ReleaseVerificationError)
		expect(() => releaseDirectoryUrl(url)).not.toThrow(/compromised/)
	})
})

describe('readSignatureFile()', () => {
	const rootKey = createRootKey()
	let alice: SignerKey
	let signingKeysList: string
	const message = createManifest('2.1.0').trim()

	beforeAll(async () => {
		alice = await createSigningKey('alice-mbp-2026')
		signingKeysList = createSigningKeysList({
			date: '2026-10-22T17:45:23Z',
			keys: [{name: alice.name, publicKey: alice.publicKey}],
			rootKey,
		})
	})

	test('reads each signature and its name, and the approved keys list', async () => {
		const signature = {name: alice.name, signature: signerSign(message, alice)}
		const signatureFile = formatSignatureFile({signingKeysList, signatures: [signature, signature]})
		const line = signatureLine(alice.name, signature.signature)
		expect(signatureFile).toBe(`--- umbrelOS Signatures ---\n${line}\n${line}\n\n${signingKeysList}`)

		const read = readSignatureFile(signatureFile, rootKey.publicKey)
		expect(read.signingKeys).toEqual(verifySigningKeysList(signingKeysList, rootKey.publicKey))
		expect(read.signatures).toEqual([signature, signature])
		expect(read.rootSignatures).toEqual([])
	})

	// Like one served with a stray line, which devices still read, but which would be left out
	test("won't write a keys list with lines outside its blocks", () => {
		for (const list of [`Approved keys\n${signingKeysList}`, `${signingKeysList}\nstray line\n`]) {
			expect(() => formatSignatureFile({signingKeysList: list, signatures: []})).toThrow('lines outside its blocks')
		}
	})

	test('reads the root key signature', () => {
		const signatureFile = `--- umbrelOS Signatures ---\n${rootSignatureLine(message, rootKey)}\n\n${signingKeysList}`
		const {rootSignatures} = readSignatureFile(signatureFile, rootKey.publicKey)
		expect(rootSignatures).toHaveLength(1)
		expect(formatSignatureFile({signingKeysList, signatures: [], rootSignatures})).toBe(signatureFile)
	})

	test('reads a list without signatures', () => {
		const read = readSignatureFile(signingKeysList, rootKey.publicKey)
		expect(read.signatures).toEqual([])
		expect(read.signingKeys).toBeDefined()
	})

	test("ignores blocks and lines it doesn't know, which later schemas can add", async () => {
		const signature = signerSign(message, alice)
		const signatureFile = [
			[
				'--- umbrelOS Signatures ---',
				'Schema: 2',
				signatureLine(alice.name, signature),
				'Signature: not a name! AAAA',
				'Root-Signature: not base64!',
				'Other-Signature: something later',
				'Note: something later',
				'',
			].join('\n'),
			signingKeysList,
			'--- OpenTimestamps Proof ---\nAAAA\n',
			'Trailing text\n',
		].join('\n')
		const {signingKeys, signatures, rootSignatures} = readSignatureFile(signatureFile, rootKey.publicKey)
		expect(signingKeys).toBeDefined()
		expect(signatures).toEqual([{name: alice.name, signature}])
		expect(rootSignatures).toEqual([])
	})

	// The device's own lists still approve signers, so a list it can't use doesn't stop it installing the
	// release
	test("leaves out a list it can't use, keeping the signatures", async () => {
		const signature = signerSign(message, alice)
		const keys = [{name: alice.name, publicKey: alice.publicKey}]
		for (const list of [
			createSigningKeysList({date: '2026-10-22T17:45:23Z', keys, rootKey: createRootKey()}),
			signingKeysList.replace('\nRoot-Signature:', '\nNote: after\nRoot-Signature: x\nRoot-Signature:'),
			signingKeysList.replace('Required-Signatures: 1', 'Required-Signatures: none'),
			'',
		]) {
			const result = readSignatureFile(
				`--- umbrelOS Signatures ---\n${signatureLine(alice.name, signature)}\n\n${list}`,
				rootKey.publicKey,
			)
			expect(result.signingKeys, list).toBeUndefined()
			expect(result.signingKeysError).toBeInstanceOf(Error)
			expect(result.signatures).toEqual([{name: alice.name, signature}])
		}
	})

	test('follows handovers past blocks it does not know', () => {
		const next = createRootKey()
		const handover = createRootKeyHandover({date: '2026-12-01T00:00:00Z', from: rootKey, to: next})
		const list = createSigningKeysList({
			date: '2026-12-02T00:00:00Z',
			keys: [{name: alice.name, publicKey: alice.publicKey}],
			rootKey: next,
		})
		const signatureFile = [list, '--- Something Later ---\nSchema: 2\n', handover].join('\n')
		expect(readSignatureFile(signatureFile, rootKey.publicKey).signingKeys?.rootKey).toBe(next.publicKey)
	})

	test('reads no signatures from a file without any', () => {
		for (const signatureFile of [
			'',
			'garbage',
			'--- umbrelOS Signatures ---\n',
			'Signature: alice AAAA\n',
			'-----BEGIN SSH SIGNATURE-----\nAAAA\n',
		]) {
			expect(readSignatureFile(signatureFile, rootKey.publicKey).signatures).toEqual([])
		}
	})
})

describe('verifyRelease()', () => {
	let alice: SignerKey
	let bob: SignerKey
	let carol: SignerKey
	let mallory: SignerKey
	let keys: SigningKey[]
	const rootKey = createRootKey()
	const signedManifest = createManifest('2.1.0')
	const signedNotes = 'Notes'
	const manifestMessage = signedManifest.trim()
	const notesMessage = createReleaseNotesMessage('2.1.0', signedNotes)
	const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex')
	let notesSignatures: ReleaseSignature[]

	const sign = async (
		signers: SignerKey[],
		{message = manifestMessage, prefix}: {message?: string; prefix?: string} = {},
	) => signers.map((signer) => ({name: signer.name, signature: signerSign(message, signer, prefix)}))
	const rootSignature = (message: string, key = rootKey) => [signBitcoinMessage(message, key.privateKey)]
	type VerifyOptions = {
		requiredSignatures?: number
		manifest?: string
		rootSignatures?: string[]
		releaseNotes?: string
		releaseNotesSignatures?: {signatures?: ReleaseSignature[]; rootSignatures?: string[]}
		revokedReleases?: {manifest: string; label?: string}[]
	}
	const verify = async (
		signatures: ReleaseSignature[],
		{
			requiredSignatures = 1,
			manifest = signedManifest,
			rootSignatures = [],
			releaseNotes = signedNotes,
			releaseNotesSignatures = {},
			revokedReleases = [],
		}: VerifyOptions = {},
	) =>
		verifyRelease({
			manifest,
			manifestSignatures: {signatures, rootSignatures},
			releaseNotes,
			releaseNotesSignatures: {
				signatures: releaseNotesSignatures.signatures ?? notesSignatures,
				rootSignatures: releaseNotesSignatures.rootSignatures ?? [],
			},
			signingKeys: {keys, requiredSignatures, revokedReleases, rootKey: rootKey.publicKey},
		})

	beforeAll(async () => {
		;[alice, bob, carol, mallory] = await Promise.all(
			['alice-mbp-2026', 'bob-mbp-2025', 'carol-mbp-2026', 'mallory-mbp'].map((name) => createSigningKey(name)),
		)
		keys = [alice, bob, carol].map(({name, publicKey}) => ({name, publicKey}))
		notesSignatures = await sign([alice, bob], {message: notesMessage})
	})

	test('signs the manifest as it is, and the release notes with the version, as hardware wallets show them', () => {
		expect(formatManifestMessage(signedManifest)).toBe(manifestMessage)
		expect(formatReleaseNotesMessage('2.1.0', signedNotes)).toBe(notesMessage)
		expect(notesMessage).toBe('--- umbrelOS Release Notes ---\nSchema: 1\nVersion: 2.1.0\n\nNotes')
		// Without whitespace at either end, which wallets can trim
		expect(formatReleaseNotesMessage('2.1.0', 'Notes\n\n')).toBe(notesMessage)
		expect(formatManifestMessage(`\n${signedManifest}\n\n`)).toBe(manifestMessage)
	})

	describe('needing one signature', () => {
		test('accepts a release signed by an approved key', async () => {
			const release = await verify(await sign([alice]))
			expect(release.version).toBe('2.1.0')
			expect(release.signers).toEqual([keys[0]])
			expect(release.files['umbrelos-amd64.update'].bundle).toBe(`sha512-256:${'ab'.repeat(32)}`)
			expect(release.name).toBe('umbrelOS 2.1.0')
			expect(release.releaseNotes).toBe('Notes')
			expect(release.releaseNotesError).toBeUndefined()
		})

		test('accepts more signatures than it needs, reporting every approved signer', async () => {
			expect((await verify(await sign([alice, bob]))).signers).toEqual([keys[0], keys[1]])
			// Others that don't count don't stop it
			expect((await verify(await sign([mallory, alice]))).signers).toEqual([keys[0]])
		})

		test('rejects a release without signatures', async () => {
			await expect(verify([])).rejects.toThrow(new ReleaseVerificationError("This release isn't signed"))
		})

		test('rejects a release signed by an unapproved key', async () => {
			await expect(verify(await sign([mallory]))).rejects.toThrow(
				new ReleaseVerificationError("This release is signed by a key that isn't approved"),
			)
		})

		// Which keeps anything else the key signs from counting
		test('rejects a signature of the message without what release signatures start with', async () => {
			await expect(verify(await sign([alice], {prefix: ''}))).rejects.toThrow(
				`This release has an invalid signature from ${alice.name}`,
			)
		})

		test('rejects a manifest changed after signing', async () => {
			const signatures = await sign([alice])
			for (const manifest of [
				signedManifest.replace('ab'.repeat(32), 'ba'.repeat(32)),
				signedManifest.replace('Version: 2.1.0', 'Version: 2.1.1'),
				signedManifest.replace('Name: umbrelOS 2.1.0', 'Name: Visit https://evil.example to finish updating'),
			]) {
				await expect(verify(signatures, {manifest})).rejects.toThrow(
					new ReleaseVerificationError(`This release has an invalid signature from ${alice.name}`),
				)
			}
		})

		// Signatures don't cover whitespace at the ends, so anything there could change what the device parses
		// or the hash a revocation matches
		test('refuses a manifest with anything around its signed text', async () => {
			const withScript = createManifest('2.1.0', {
				files: {
					'umbrelos-amd64.update': {
						sha256: 'ef'.repeat(32),
						bundle: `sha512-256:${'ab'.repeat(32)}`,
						bootFlow: 'grub',
						arch: 'amd64',
					},
					'update.sh': {sha256: '12'.repeat(32), type: 'update-script'},
				},
			})
			const signatures = await sign([alice], {message: withScript.trim()})
			await expect(verify(signatures, {manifest: withScript})).resolves.toMatchObject({version: '2.1.0'})
			for (const manifest of [
				`${withScript}\n`,
				`${withScript} \n`,
				`\n${withScript}`,
				withScript.trimEnd(),
				// Which would otherwise drop the update script's line, as it can't be parsed
				withScript.replace(/\n$/, '\r\n'),
				withScript.replace(/\n$/, '\x01\n'),
			]) {
				await expect(verify(signatures, {manifest}), JSON.stringify(manifest.slice(-12))).rejects.toThrow(
					new ReleaseVerificationError('The release manifest is malformed'),
				)
			}
		})

		test("doesn't let invalid copies of a signature hide a valid one", async () => {
			const [invalid] = await sign([alice], {prefix: ''})
			expect((await verify([invalid, invalid, invalid, ...(await sign([alice]))])).signers).toEqual([keys[0]])
		})

		test('rejects more than one bad signature without a valid one', async () => {
			await expect(verify(await sign([mallory, mallory]))).rejects.toThrow(
				'This release has 0 of the 1 signatures it needs from approved keys',
			)
		})
	})

	describe('needing two signatures', () => {
		test('accepts a release signed by two approved keys', async () => {
			expect((await verify(await sign([alice, bob]), {requiredSignatures: 2})).signers).toEqual([keys[0], keys[1]])
			expect((await verify(await sign([carol, alice, bob]), {requiredSignatures: 2})).signers).toEqual([
				keys[2],
				keys[0],
				keys[1],
			])
		})

		test('rejects a release signed by one approved key', async () => {
			await expect(verify(await sign([alice]), {requiredSignatures: 2})).rejects.toThrow(
				'This release has 1 of the 2 signatures it needs from approved keys',
			)
		})

		test('counts each key once', async () => {
			await expect(verify(await sign([alice, alice]), {requiredSignatures: 2})).rejects.toThrow(
				'This release has 1 of the 2 signatures it needs from approved keys',
			)
		})

		test("doesn't count a signature from an unapproved key", async () => {
			await expect(verify(await sign([alice, mallory]), {requiredSignatures: 2})).rejects.toThrow(
				'This release has 1 of the 2 signatures it needs from approved keys',
			)
		})

		test("doesn't count an invalid signature from an approved key", async () => {
			const signatures = [...(await sign([alice])), ...(await sign([bob], {prefix: ''}))]
			await expect(verify(signatures, {requiredSignatures: 2})).rejects.toThrow(
				'This release has 1 of the 2 signatures it needs from approved keys',
			)
			const otherRelease = [...(await sign([alice])), ...(await sign([bob], {message: createManifest('2.1.1').trim()}))]
			await expect(verify(otherRelease, {requiredSignatures: 2})).rejects.toThrow('1 of the 2 signatures')
		})

		test('rejects a release without signatures', async () => {
			await expect(verify([], {requiredSignatures: 2})).rejects.toThrow("This release isn't signed")
		})
	})

	// Signed separately, so fixing them never signs what devices install again
	describe('release notes', () => {
		const notesError = async (options: VerifyOptions) => {
			const release = await verify(await sign([alice]), options)
			expect(release.releaseNotes).toBe('')
			return release.releaseNotesError
		}

		test('installs a release without showing release notes that are changed after signing', async () => {
			expect(await notesError({releaseNotes: 'Visit https://evil.example to finish updating'})).toEqual(
				new ReleaseVerificationError('This release has 0 of the 1 signatures it needs from approved keys'),
			)
		})

		test("doesn't show release notes signed for another release", async () => {
			const signatures = await sign([alice], {message: createReleaseNotesMessage('2.0.0', signedNotes)})
			expect(await notesError({releaseNotesSignatures: {signatures}})).toBeInstanceOf(ReleaseVerificationError)
		})

		// The manifest's signatures can't be passed off as the release notes', or the other way round
		test("doesn't take signatures of the manifest for the release notes", async () => {
			const signatures = await sign([alice])
			expect(await notesError({releaseNotes: signedManifest, releaseNotesSignatures: {signatures}})).toBeInstanceOf(
				ReleaseVerificationError,
			)
			await expect(verify(notesSignatures)).rejects.toThrow('0 of the 1 signatures')
		})

		test('needs as many signatures from approved keys as the release', async () => {
			const signatures = await sign([alice], {message: notesMessage})
			const release = await verify(await sign([alice, bob]), {
				requiredSignatures: 2,
				releaseNotesSignatures: {signatures},
			})
			expect(release.releaseNotesError?.message).toBe(
				'This release has 1 of the 2 signatures it needs from approved keys',
			)
			expect(
				await notesError({releaseNotesSignatures: {signatures: [...(await sign([mallory], {message: notesMessage}))]}}),
			).toBeInstanceOf(ReleaseVerificationError)
		})

		test('shows only what was signed of the release notes', async () => {
			const release = await verify(await sign([alice]), {releaseNotes: `${signedNotes}\n\x01\x1b \t\n`})
			expect(release.releaseNotes).toBe(signedNotes)
		})

		test('shows release notes the root key signed', async () => {
			const release = await verify(await sign([alice]), {
				releaseNotesSignatures: {signatures: [], rootSignatures: rootSignature(notesMessage)},
			})
			expect(release.releaseNotes).toBe(signedNotes)
		})

		test('installs a release without release notes', async () => {
			const release = await verifyRelease({
				manifest: signedManifest,
				manifestSignatures: {signatures: await sign([alice]), rootSignatures: []},
				signingKeys: {keys, requiredSignatures: 1, revokedReleases: [], rootKey: rootKey.publicKey},
			})
			expect(release).toMatchObject({version: '2.1.0', releaseNotes: ''})
			expect(release.releaseNotesError?.message).toBe('This release has no release notes')
		})
	})

	// In an emergency, like every signing key being lost, the root key can sign a release by itself
	describe('signed by the root key', () => {
		test('accepts it however many signatures the list requires', async () => {
			const release = await verify([], {requiredSignatures: 2, rootSignatures: rootSignature(manifestMessage)})
			expect(release).toMatchObject({version: '2.1.0', name: 'umbrelOS 2.1.0', signedByRootKey: true, signers: []})
			// Alongside signatures that don't count
			await expect(
				verify(await sign([mallory]), {requiredSignatures: 2, rootSignatures: rootSignature(manifestMessage)}),
			).resolves.toMatchObject({signedByRootKey: true})
		})

		test('is a signature of the manifest', async () => {
			for (const {message, manifest} of [
				{message: notesMessage, manifest: signedManifest},
				{message: manifestMessage, manifest: signedManifest.replace('ab'.repeat(32), 'ba'.repeat(32))},
			]) {
				await expect(verify([], {rootSignatures: rootSignature(message), manifest})).rejects.toThrow(
					new ReleaseVerificationError('This release has an invalid signature from the root key'),
				)
			}
		})

		test('rejects one from another key, like a root key it handed over from', async () => {
			await expect(verify([], {rootSignatures: rootSignature(manifestMessage, createRootKey())})).rejects.toThrow(
				'This release has an invalid signature from the root key',
			)
		})

		test('refuses a revoked release it signed', async () => {
			await expect(
				verify([], {
					rootSignatures: rootSignature(manifestMessage),
					revokedReleases: [{manifest: sha256(signedManifest)}],
				}),
			).rejects.toThrow(new ReleaseVerificationError('umbrelOS 2.1.0 has been revoked'))
		})

		test('still accepts enough signatures from approved keys when the root signature is invalid', async () => {
			const release = await verify(await sign([alice, bob]), {
				requiredSignatures: 2,
				rootSignatures: rootSignature(manifestMessage, createRootKey()),
			})
			expect(release).toMatchObject({signedByRootKey: false, signers: [keys[0], keys[1]]})
		})
	})

	test('rejects malformed signatures and manifests', async () => {
		const [signature] = await sign([alice])

		const bytes = Buffer.from(signature.signature, 'base64')
		const flipped = Buffer.from(bytes)
		flipped[10] ^= 1
		// Only the 64 bytes of r and s, as canonical base64, and not DER, which also encodes them
		const der = crypto.sign('sha256', Buffer.from(`umbrelOS release signature\n${manifestMessage}`), alice.privateKey)
		for (const malformed of [
			'garbage',
			flipped.toString('base64'),
			bytes.subarray(0, 63).toString('base64'),
			Buffer.concat([bytes, Buffer.from([0])]).toString('base64'),
			signature.signature.replace(/=*$/, ''),
			der.toString('base64'),
		]) {
			await expect(verify([{name: alice.name, signature: malformed}]), malformed).rejects.toThrow(
				new ReleaseVerificationError(`This release has an invalid signature from ${alice.name}`),
			)
		}

		const manifest = signedManifest.replace('Version: 2.1.0', 'Version: v2.1.0')
		await expect(verify(await sign([alice], {message: manifest.trim()}), {manifest})).rejects.toThrow(
			'The release manifest has an invalid version',
		)
	})

	// So a signature file can't say someone else signed it
	test("doesn't count a signature under another approved key's name", async () => {
		const [aliceSignature, bobSignature] = await sign([alice, bob])
		const underBobsName = {...aliceSignature, name: bob.name}
		await expect(verify([underBobsName])).rejects.toThrow(
			new ReleaseVerificationError(`This release has an invalid signature from ${bob.name}`),
		)
		await expect(verify([underBobsName, bobSignature], {requiredSignatures: 2})).rejects.toThrow(
			'This release has 1 of the 2 signatures it needs from approved keys',
		)
	})

	test("can't get a revoked release past its revocation by adding to the manifest", async () => {
		const revokedReleases = [{manifest: sha256(signedManifest)}]
		const signatures = await sign([alice])
		for (const manifest of [`${signedManifest}\n`, `${signedManifest} \n`, `\n${signedManifest}`]) {
			await expect(verify(signatures, {manifest, revokedReleases})).rejects.toThrow(ReleaseVerificationError)
		}
	})

	// By its manifest's hash, so exactly that release is revoked, and not another with the same version
	test('refuses a revoked release however many approved keys signed it', async () => {
		const signatures = await sign([alice, bob, carol])
		await expect(
			verify(signatures, {
				revokedReleases: [{manifest: 'ab'.repeat(32)}, {manifest: sha256(signedManifest), label: '2.1.0'}],
			}),
		).rejects.toThrow(new ReleaseVerificationError('umbrelOS 2.1.0 has been revoked'))

		const rebuilt = createManifest('2.1.0', {date: '2026-11-05T12:00:00Z'})
		await expect(
			verify(await sign([alice], {message: rebuilt.trim()}), {
				manifest: rebuilt,
				revokedReleases: [{manifest: sha256(signedManifest), label: '2.1.0'}],
			}),
		).resolves.toMatchObject({version: '2.1.0'})
	})

	test('checks at most 32 signatures however many the file has', async () => {
		// From an approved key, so each one is checked
		const [invalid] = await sign([bob], {prefix: ''})
		const [valid] = await sign([alice])
		const started = Date.now()
		await expect(verify([...Array(2000).fill(invalid), valid])).rejects.toThrow(
			'This release has 0 of the 1 signatures it needs from approved keys',
		)
		expect(Date.now() - started).toBeLessThan(5000)
		expect((await verify([...Array(31).fill(invalid), valid])).signers).toEqual([keys[0]])
	})

	test('verifies a signature by a real Secure Enclave key', () => {
		const {message, signature, publicKey} = secureEnclaveSignatureVector
		expect(verifySignerSignature(message, signature, publicKey)).toBe(true)
		expect(verifySignerSignature(`${message}!`, signature, publicKey)).toBe(false)
		expect(verifySignerSignature(message, signature, keys[0].publicKey)).toBe(false)
	})
})

// Releases in schema 1 exactly as the release tools publish them, signed by fixed keys. Devices in the field
// keep the parser they shipped with, so every later version has to keep accepting these.
describe('schema 1', () => {
	const rootPublicKey = '02b8e4f8f0400b22f7d347992cefd5b8f1566126a6dfaccf87e01c27c05e03a9a6'
	const manifest = [
		'--- umbrelOS Manifest ---',
		'Schema: 1',
		'Version: 2.1.0',
		'Name: umbrelOS 2.1',
		'Date: 2026-11-04T12:00:00Z',
		'Docker-Image: ghcr.io/getumbrel/umbrelos@sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
		'File: umbrelos-amd64.img.xz sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
		'File: umbrelos-amd64.update sha256:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef bundle:sha512-256:abababababababababababababababababababababababababababababababab boot-flow:grub arch:amd64',
		'File: update.sh sha256:1212121212121212121212121212121212121212121212121212121212121212 type:update-script',
		'',
	].join('\n')
	const releaseNotes = "## What's new\n\n- Signed updates\n"
	const manifestSignatureFile = [
		'--- umbrelOS Signatures ---',
		'Signature: alice-mbp-2026 VQfSd56LUH5Xj9nglWFNLkWv2znkKmQUeXcVidtlHmUIfFuU7Vf+8gty3pPM9HVvKDz2jZ9ldYRqBQOC7qcAhg==',
		'Signature: bob-mbp-2025 iVg0RefmTVkrgprmY5nLNqBwipk+FWRsvSZTf+0UR7fcXRsh/ZGfQ25LvIy6EYo4lmpBURotJpRqOQR8RuVO6Q==',
		'',
		'--- umbrelOS Signing Keys ---',
		'Schema: 1',
		'Date: 2026-10-28T12:00:00Z',
		'Required-Signatures: 2',
		'Key: alice-mbp-2026 0325b090113c820cd564045d90af830f942ea431a746a8657872871a41a491529e',
		'Key: bob-mbp-2025 02c1fdd986a41fcb0cb6fa6507442dba03bb8067d61a3274bbb6d9328ac2ee3743',
		'Revoked-Release: sha256:3434343434343434343434343434343434343434343434343434343434343434 2.0.1',
		'Root-Signature: H0rTQNfZqJNoHGu4vgpx4MgPdtj3vopuI5DMv1WZLZ3OzPyxwXS6DIKo0ZMeXSZdFW14C6gu1YAoCMspvfNDazk=',
		'',
	].join('\n')
	const releaseNotesSignatureFile = [
		'--- umbrelOS Signatures ---',
		'Signature: alice-mbp-2026 0n2JMWuKigFOTlVIX6PRhPlY2UT396qbCQa2oS/ncxhaK6VJ+VAwIWX/wFy/S7vGlvmPV+/UkSVxGd6F9csR6A==',
		'Signature: bob-mbp-2025 EtAGCeswSuGDchDR5MvgXbq61lA+IwJYoDRmIP5lCKmv7fzhQ//nnqT+XvseD5qmHy2itwhFHiH1uXk72Zosfw==',
		'',
		'--- umbrelOS Signing Keys ---',
		'Schema: 1',
		'Date: 2026-10-28T12:00:00Z',
		'Required-Signatures: 2',
		'Key: alice-mbp-2026 0325b090113c820cd564045d90af830f942ea431a746a8657872871a41a491529e',
		'Key: bob-mbp-2025 02c1fdd986a41fcb0cb6fa6507442dba03bb8067d61a3274bbb6d9328ac2ee3743',
		'Revoked-Release: sha256:3434343434343434343434343434343434343434343434343434343434343434 2.0.1',
		'Root-Signature: H0rTQNfZqJNoHGu4vgpx4MgPdtj3vopuI5DMv1WZLZ3OzPyxwXS6DIKo0ZMeXSZdFW14C6gu1YAoCMspvfNDazk=',
		'',
	].join('\n')

	test('verifies', async () => {
		const manifestSignatures = readSignatureFile(manifestSignatureFile, rootPublicKey)
		const releaseNotesSignatures = readSignatureFile(releaseNotesSignatureFile, rootPublicKey)
		const signingKeys = manifestSignatures.signingKeys!
		const release = await verifyRelease({
			manifest,
			manifestSignatures,
			releaseNotes,
			releaseNotesSignatures,
			signingKeys,
		})
		expect(release).toEqual({
			version: '2.1.0',
			date: new Date('2026-11-04T12:00:00Z'),
			dockerImage: `ghcr.io/getumbrel/umbrelos@sha256:${'cd'.repeat(32)}`,
			files: {
				'umbrelos-amd64.img.xz': {sha256: 'cd'.repeat(32)},
				'umbrelos-amd64.update': {
					sha256: 'ef'.repeat(32),
					bundle: `sha512-256:${'ab'.repeat(32)}`,
					bootFlow: 'grub',
					arch: 'amd64',
				},
				'update.sh': {sha256: '12'.repeat(32), type: 'update-script'},
			},
			name: 'umbrelOS 2.1',
			// What was signed, without the newline at the end
			releaseNotes: releaseNotes.trimEnd(),
			releaseNotesError: undefined,
			signers: [
				{name: 'alice-mbp-2026', publicKey: '0325b090113c820cd564045d90af830f942ea431a746a8657872871a41a491529e'},
				{name: 'bob-mbp-2025', publicKey: '02c1fdd986a41fcb0cb6fa6507442dba03bb8067d61a3274bbb6d9328ac2ee3743'},
			],
			signedByRootKey: false,
		})
		expect(signingKeys.requiredSignatures).toBe(2)
		expect(signingKeys.revokedReleases).toEqual([{manifest: '34'.repeat(32), label: '2.0.1'}])
	})

	test('is what the release tools write', () => {
		for (const signatureFile of [manifestSignatureFile, releaseNotesSignatureFile]) {
			const {signingKeys, signatures} = readSignatureFile(signatureFile, rootPublicKey)
			expect(formatSignatureFile({signingKeysList: signingKeys!.text, signatures})).toBe(signatureFile)
			expect(signingKeys!.text).toBe(
				formatSigningKeysList({
					...signingKeys!,
					rootSignatures: parseSigningKeysList(signingKeys!.text).rootSignatures,
				}),
			)
		}
		const {name, files, dockerImage} = parseReleaseManifest(manifest)
		expect(createManifest('2.1.0', {name, dockerImage, files})).toBe(manifest)
	})

	// A release signed by the root key alone, after the root key moved to a new hardware wallet
	test('verifies a root key handover and a release signed by the root key', async () => {
		const firstRootKey = '03edb93d7304bd66f7f4c4e370bd1a64edeacda9f6381c12927bd4781d3a368998'
		const manifest = [
			'--- umbrelOS Manifest ---',
			'Schema: 1',
			'Version: 2.1.1',
			'Name: umbrelOS 2.1.1',
			'Date: 2026-11-04T12:00:00Z',
			'File: umbrelos-amd64.img.xz sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
			'File: umbrelos-amd64.update sha256:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef bundle:sha512-256:abababababababababababababababababababababababababababababababab boot-flow:grub arch:amd64',
			'',
		].join('\n')
		const releaseNotes = '- Emergency fix\n'
		const manifestSignatureFile = [
			'--- umbrelOS Signatures ---',
			'Root-Signature: H13Ase8pLqZHwYyUB9KIoV66rHcQSAGv6xs3UJWGmHrxH6LPAmmSgnfGsAbs7KVU/5DAvOUQXesTOB3hBKEKijI=',
			'',
			'--- umbrelOS Signing Keys ---',
			'Schema: 1',
			'Date: 2027-03-02T12:00:00Z',
			'Required-Signatures: 2',
			'Key: alice-mbp-2026 0325b090113c820cd564045d90af830f942ea431a746a8657872871a41a491529e',
			'Key: bob-mbp-2025 02c1fdd986a41fcb0cb6fa6507442dba03bb8067d61a3274bbb6d9328ac2ee3743',
			'Root-Signature: H7AshwHgv21Q/m+bZTasu+LamYDAE5MpYA1cicBOv1/EFfSrxSpiKvzSobTSwrBIQA8gZxLr7fQaH7R0nSD1tOU=',
			'',
			'--- umbrelOS Root Key Handover ---',
			'Schema: 1',
			'Date: 2027-03-01T12:00:00Z',
			'From: 03edb93d7304bd66f7f4c4e370bd1a64edeacda9f6381c12927bd4781d3a368998',
			'To: 03e5a72c06b5be97b001e9542f167e76f0fb552d20d323f4d5712260834a2d333f',
			'Root-Signature: Hxfw1X0sknrM/GJNsJfra3KlIpr33VWIdgHDDAYy8DAM/aurf2sDRfMKtKED0LJHdxF5V+Wtr/o7AxsjPM1aQCk=',
			'',
		].join('\n')
		const releaseNotesSignatureFile = [
			'--- umbrelOS Signatures ---',
			'Root-Signature: H/ZiIo7LdQan1Yt7+77kkzBvB5oUgFkoJdKU82qhqq9c9dwYYm40SYwDmbcYCg/nhAe9mt4nd0jzAJ7vsLikfFE=',
			'',
			'--- umbrelOS Signing Keys ---',
			'Schema: 1',
			'Date: 2027-03-02T12:00:00Z',
			'Required-Signatures: 2',
			'Key: alice-mbp-2026 0325b090113c820cd564045d90af830f942ea431a746a8657872871a41a491529e',
			'Key: bob-mbp-2025 02c1fdd986a41fcb0cb6fa6507442dba03bb8067d61a3274bbb6d9328ac2ee3743',
			'Root-Signature: H7AshwHgv21Q/m+bZTasu+LamYDAE5MpYA1cicBOv1/EFfSrxSpiKvzSobTSwrBIQA8gZxLr7fQaH7R0nSD1tOU=',
			'',
			'--- umbrelOS Root Key Handover ---',
			'Schema: 1',
			'Date: 2027-03-01T12:00:00Z',
			'From: 03edb93d7304bd66f7f4c4e370bd1a64edeacda9f6381c12927bd4781d3a368998',
			'To: 03e5a72c06b5be97b001e9542f167e76f0fb552d20d323f4d5712260834a2d333f',
			'Root-Signature: Hxfw1X0sknrM/GJNsJfra3KlIpr33VWIdgHDDAYy8DAM/aurf2sDRfMKtKED0LJHdxF5V+Wtr/o7AxsjPM1aQCk=',
			'',
		].join('\n')

		const manifestSignatures = readSignatureFile(manifestSignatureFile, firstRootKey)
		const releaseNotesSignatures = readSignatureFile(releaseNotesSignatureFile, firstRootKey)
		expect(manifestSignatures.signingKeys!.rootKey).toBe(
			'03e5a72c06b5be97b001e9542f167e76f0fb552d20d323f4d5712260834a2d333f',
		)
		const release = await verifyRelease({
			manifest,
			manifestSignatures,
			releaseNotes,
			releaseNotesSignatures,
			signingKeys: manifestSignatures.signingKeys!,
		})
		expect(release).toMatchObject({
			version: '2.1.1',
			name: 'umbrelOS 2.1.1',
			signedByRootKey: true,
			releaseNotes: releaseNotes.trimEnd(),
		})
		const {signingKeys, signatures, rootSignatures} = manifestSignatures
		expect(formatSignatureFile({signingKeysList: signingKeys!.text, signatures, rootSignatures})).toBe(
			manifestSignatureFile,
		)
	})
})
