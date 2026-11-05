import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'

import semver from 'semver'

// umbrelOS only installs a release if it's signed by a key that an offline root key has approved.
//
// The root key lives on a hardware wallet and signs the approved signing keys list, as a Bitcoin signed
// message. Each release signer has a P-256 key their Mac's Secure Enclave created, which can't leave it
// and only signs with Touch ID, and signs releases with ./scripts/release-signing sign.
//
// Approving and revoking signers are the same action: publish a new list containing every active key,
// signed by the root and dated later than the last one. The list also sets how many approved signers
// each release needs. Devices fetch it daily and before every update, and only replace their copy with
// a validly signed newer list, so serving an old list can't undo a revocation. Lists don't expire
// though, so a device that can't reach any source keeps trusting the newest list it has seen. The list
// can also revoke signed releases by the hash of their manifest, which devices then refuse to install.
//
// A release is four files in its directory on the download server, like
// https://download.umbrel.com/release/2.1.0/, or https://download.umbrel.com/<tag>/ for a test build:
//
//   manifest.txt          CI writes it with the release's version and name, umbreld's, and a hash of
//                         every file in it, and timestamps it with OpenTimestamps. It never changes.
//   manifest.txt.sig      Signatures of the manifest, and the root-signed keys list their signers were
//                         approved by
//   release-notes.md      The release notes users see, in Markdown, with sections for devices updating
//                         from particular versions if they need their own
//   release-notes.md.sig  Signatures of the release notes with the release's version
//
// Signers sign the text of each file, so a hardware wallet shows exactly what it signs, and the update
// server can't show users anything the signers didn't sign. A release can be verified with nothing but
// the root key built into umbreld. Fixing the release notes only signs the release notes again, never
// what devices install, and a device installs a release even if its release notes don't verify, without
// showing them.
//
// Devices in the field keep the parsers they shipped with, so the formats can't change in ways those
// parsers reject. Parsers ignore fields, details, lines and blocks they can't read, so new ones can be
// added as long as older devices are safe ignoring them. Each block's Schema field says which version of
// its format wrote it, for later parsers, and devices don't refuse a block for it. A change older devices
// mustn't ignore goes in a block with a new header, which they don't read.

// The root key every release trusts, where the chain of root key handovers starts. When the root key
// moves to a new hardware wallet, the current key signs a handover to the new one, which lists carry from
// then on, so a device follows the chain to the new key and stops trusting the old one. This key stays
// the same, as every list's chain starts from it.
//
// It's the key at m/84'/0'/0'/0/0 on the root key's hardware wallet, whose address is
// bc1qz6c2t7ncjlm6fdy5a0y46cxy8m5nm0hkcxcamh.
export const ROOT_PUBLIC_KEY = '03672a5a18af7d5b1300323eb2eb9cae496a5cceb8a566e7554d635b00b8167ff1'

// What a signer's key signs before each message, so nothing else it ever signs can count as a release
// signature. The tools' Secure Enclave helper adds it itself, so the key never signs anything without it.
const SIGNER_MESSAGE_PREFIX = 'umbrelOS release signature\n'

// The version of each format this writes
const SCHEMA = '1'

const SIGNING_KEYS_HEADER = '--- umbrelOS Signing Keys ---'
const ROOT_KEY_HANDOVER_HEADER = '--- umbrelOS Root Key Handover ---'
// The fields that end a signed block, one line for each signature: Root-Signature: <base64> by the root key
// and Signature: <name> <base64> by a release signer
const ROOT_SIGNATURE = 'Root-Signature'
const SIGNATURE = 'Signature'
const MANIFEST_HEADER = '--- umbrelOS Manifest ---'
const RELEASE_NOTES_HEADER = '--- umbrelOS Release Notes ---'
const SIGNATURES_HEADER = '--- umbrelOS Signatures ---'

// Every source is untrusted since lists are verified against the root key, so the device takes the
// newest valid list from all of them rather than trusting whichever answers first
export const SIGNING_KEYS_URLS = [
	'https://api.umbrel.com/umbrelos-signing-keys',
	// releases/umbrelos-signing-keys.txt in the public repo, a path that never moves. Revocations only
	// matter against an attacker who can serve releases, who could also have taken over api.umbrel.com,
	// so devices need a source that doesn't depend on it.
	'https://raw.githubusercontent.com/getumbrel/umbrel/master/releases/umbrelos-signing-keys.txt',
]

// The newest list when this release was built, so a device never trusts less than its own release did
export const BUNDLED_SIGNING_KEYS_PATH = fileURLToPath(new URL('./umbrelos-signing-keys.txt', import.meta.url))

// Files a release directory holds alongside the release's own files
export const MANIFEST_FILE = 'manifest.txt'
export const MANIFEST_SIGNATURE_FILE = `${MANIFEST_FILE}.sig`
export const RELEASE_NOTES_FILE = 'release-notes.md'
export const RELEASE_NOTES_SIGNATURE_FILE = `${RELEASE_NOTES_FILE}.sig`

// A release signer's approved key, by its name and its compressed P-256 public key in hex
export type SigningKey = {name: string; publicKey: string}
// A release signer's signature, in base64, and the name of the approved key it says it's from
export type ReleaseSignature = {name: string; signature: string}
export type RevokedRelease = {manifest: string; label?: string}
export type RootKeyHandover = {date: Date; from: string; to: string; message: string; rootSignatures: string[]}
export type SigningKeysList = {
	date: Date
	requiredSignatures: number
	keys: SigningKey[]
	// Signed releases devices refuse to install, by the SHA-256 of their manifest, and a label for people
	revokedReleases: RevokedRelease[]
	// The handovers from the first root key to the one that signed the list, which is rootKey
	handovers: RootKeyHandover[]
	rootKey: string
	text: string
}
export type ReleaseFile = {
	sha256: string
	// The Rugix bundle hash of an update bundle
	bundle?: string
	// The Rugix boot flow and Debian architecture of the devices an update bundle is for
	bootFlow?: string
	arch?: string
	// update-script for the release's update script
	type?: string
}
export type ReleaseManifest = {
	version: string
	// What the release calls itself once it's installed, like umbrelOS 2.1
	name: string
	date: Date
	// The release's Docker image by its index digest, which covers every platform's image
	dockerImage?: string
	files: Record<string, ReleaseFile>
}
// A signature file's signatures
export type Signatures = {signatures: ReleaseSignature[]; rootSignatures: string[]}

// An update failed for a reason the user should know. The message is shown to the user.
export class UpdateError extends Error {}

// A release failed verification
export class ReleaseVerificationError extends UpdateError {}

// DER prefix of a secp256k1 SubjectPublicKeyInfo holding a 33 byte compressed point
const SECP256K1_SPKI_PREFIX = Buffer.from('3036301006072a8648ce3d020106052b8104000a032200', 'hex')

function sha256(data: crypto.BinaryLike) {
	return crypto.createHash('sha256').update(data).digest()
}

// Bitcoin's variable length integer encoding
function compactSize(value: number) {
	if (value < 0xfd) return Buffer.from([value])
	if (value <= 0xffff) return Buffer.from([0xfd, value & 0xff, value >> 8])
	const buffer = Buffer.alloc(5)
	buffer[0] = 0xfe
	buffer.writeUInt32LE(value, 1)
	return buffer
}

// Verify a Bitcoin signed message, in the Standard (Electrum) or BIP137 format, against a known public
// key. The signature's header byte only exists to recover the key and pick an address
// type, so with the key known only r and s need checking, which OpenSSL can do without key recovery.
export function verifyBitcoinMessage(message: string, signature: string, publicKey: string) {
	try {
		const signatureBytes = Buffer.from(signature, 'base64')
		if (signatureBytes.length !== 65 || signatureBytes.toString('base64') !== signature) return false
		const header = signatureBytes[0]
		if (header < 27 || header > 42) return false

		const messageBytes = Buffer.from(message, 'utf8')
		const prefix = Buffer.from('\x18Bitcoin Signed Message:\n', 'latin1')
		const key = crypto.createPublicKey({
			key: Buffer.concat([SECP256K1_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
			format: 'der',
			type: 'spki',
		})

		// The signature commits to a double SHA-256 and crypto.verify() applies the second one
		const hash = sha256(Buffer.concat([prefix, compactSize(messageBytes.length), messageBytes]))
		return crypto.verify('sha256', hash, {key, dsaEncoding: 'ieee-p1363'}, signatureBytes.subarray(1))
	} catch {
		return false
	}
}

// Parse the "Key: value" fields of a block. Unknown fields, like Schema, which is only a hint for later
// parsers, are left for the caller to ignore, and lines that aren't fields are left out.
function parseFields(lines: string[], fail: (message: string) => Error) {
	const fields = lines.flatMap((line) => {
		const match = line.match(/^([A-Za-z][A-Za-z0-9-]*):(?: (.*))?$/)
		return match ? [{name: match[1], value: match[2] ?? ''}] : []
	})

	return {
		// The value of a field that has to appear exactly once
		one(name: string) {
			const matches = fields.filter((field) => field.name === name)
			if (matches.length !== 1) throw fail(`has an invalid ${name.toLowerCase()}`)
			return matches[0].value
		},
		all: (name: string) => fields.filter((field) => field.name === name).map((field) => field.value),
	}
}

const formatDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

// Parse a date like 2026-10-22T17:45:23Z, rejecting impossible dates like February 30th
function parseDate(dateString: string) {
	const date = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(dateString) ? dateString : NaN)
	if (Number.isNaN(date.getTime()) || formatDate(date) !== dateString) return undefined
	return date
}

// The message the root key signs for a list of approved keys
export function formatSigningKeysListMessage({
	date,
	requiredSignatures,
	keys,
	revokedReleases = [],
}: {
	date: Date
	requiredSignatures: number
	keys: SigningKey[]
	revokedReleases?: RevokedRelease[]
}) {
	return [
		SIGNING_KEYS_HEADER,
		`Schema: ${SCHEMA}`,
		`Date: ${formatDate(date)}`,
		`Required-Signatures: ${requiredSignatures}`,
		...keys.map((key) => `Key: ${key.name} ${key.publicKey}`),
		...revokedReleases.map(({manifest, label}) => `Revoked-Release: sha256:${manifest}${label ? ` ${label}` : ''}`),
	].join('\n')
}

// The message a root key signs to hand over to a new one
export function formatRootKeyHandoverMessage({date, from, to}: {date: Date; from: string; to: string}) {
	return [
		ROOT_KEY_HANDOVER_HEADER,
		`Schema: ${SCHEMA}`,
		`Date: ${formatDate(date)}`,
		`From: ${from}`,
		`To: ${to}`,
	].join('\n')
}

// The most signatures of a message a device checks, of each kind, far more than any release needs
const MAX_SIGNATURES = 32

// A signed block is its message, then a line for each signature of it. The message is every line before
// the first signature, without a trailing newline, since wallets can trim the message they sign:
//
// --- umbrelOS Release ---
// <message lines>
// Root-Signature: <base64 Bitcoin signed message by the root key>
// Signature: <the name of an approved key> <base64 signature by that key>
//
// Lines after the first signature that aren't signatures this reads are left for later schemas. Only the
// first MAX_SIGNATURES root signatures are read, since each is checked until one verifies, so a block
// padded with them, which a device could save, can't make every check slow.
function parseSignedBlock(lines: string[]) {
	const start = lines.findIndex((line) => line.startsWith(`${ROOT_SIGNATURE}:`) || line.startsWith(`${SIGNATURE}:`))
	const messageLines = start === -1 ? lines : lines.slice(0, start)
	const signatureLines = start === -1 ? [] : lines.slice(start)
	const rootSignatures = signatureLines
		.flatMap((line) => {
			const signature = line.match(new RegExp(`^${ROOT_SIGNATURE}: ([A-Za-z0-9+/=]+)$`))?.[1]
			return signature ? [signature] : []
		})
		.slice(0, MAX_SIGNATURES)
	const signatures = signatureLines.flatMap((line): ReleaseSignature[] => {
		const match = line.match(new RegExp(`^${SIGNATURE}: ([A-Za-z0-9._-]+) ([A-Za-z0-9+/=]+)$`))
		return match ? [{name: match[1], signature: match[2]}] : []
	})
	return {messageLines, message: messageLines.join('\n'), rootSignatures, signatures}
}

const formatSignedBlock = (
	message: string,
	{rootSignatures = [], signatures = []}: {rootSignatures?: string[]; signatures?: ReleaseSignature[]},
) =>
	[
		message,
		...rootSignatures.map((signature) => `${ROOT_SIGNATURE}: ${signature}`),
		...signatures.map(({name, signature}) => `${SIGNATURE}: ${name} ${signature}`),
	]
		.map((line) => `${line}\n`)
		.join('')

export function formatSigningKeysList({
	rootSignatures,
	handovers = [],
	...list
}: {
	date: Date
	requiredSignatures: number
	keys: SigningKey[]
	revokedReleases?: RevokedRelease[]
	rootSignatures: string[]
	handovers?: Pick<RootKeyHandover, 'message' | 'rootSignatures'>[]
}) {
	return [
		formatSignedBlock(formatSigningKeysListMessage(list), {rootSignatures}),
		...handovers.map((handover) => formatSignedBlock(handover.message, {rootSignatures: handover.rootSignatures})),
	].join('\n')
}

// Split text into blocks, each a "--- Title ---" header and the lines after it up to a blank line. Lines
// outside a block make it malformed, or with lenient they're left out.
function parseBlocks(text: string, {lenient = false}: {lenient?: boolean} = {}) {
	const blocks: string[][] = []
	let inBlock = false
	for (const line of text.split('\n')) {
		if (/^--- .+ ---$/.test(line)) {
			blocks.push([line])
			inBlock = true
		} else if (line === '') {
			inBlock = false
		} else if (inBlock) {
			blocks.at(-1)!.push(line)
		} else if (!lenient) {
			return undefined
		}
	}
	return blocks
}

const formatBlocks = (blocks: string[][]) => blocks.map((block) => `${block.join('\n')}\n`).join('\n')

const isPublicKey = (value: string) => /^0[23][0-9a-f]{64}$/.test(value)

// Parse a root key handover, which a root key signs to hand over to a new one:
//
// --- umbrelOS Root Key Handover ---
// Schema: 1
// Date: 2027-03-01T12:00:00Z
// From: <the current root's public key>
// To: <the new root's public key>
// Root-Signature: <base64 signature by the current root key>
function parseRootKeyHandover(lines: string[]): RootKeyHandover {
	const fail = (message: string) => new Error(`Root key handover ${message}`)
	const {messageLines, message, rootSignatures} = parseSignedBlock(lines)
	const [header, ...fieldLines] = messageLines
	if (header !== ROOT_KEY_HANDOVER_HEADER) throw fail('has an invalid header')
	const fields = parseFields(fieldLines, fail)

	const date = parseDate(fields.one('Date'))
	if (!date) throw fail('has an invalid date')
	const from = fields.one('From')
	const to = fields.one('To')
	if (!isPublicKey(from) || !isPublicKey(to) || from === to) throw fail('has an invalid key')

	return {date, from, to, message, rootSignatures}
}

// Parse an approved signing keys list without checking its signatures:
//
// --- umbrelOS Signing Keys ---
// Schema: 1
// Date: 2026-10-22T17:45:23Z
// Required-Signatures: 1
// Key: lukechilds-mbp-2026 <the signer's compressed P-256 public key in hex>
// Revoked-Release: sha256:<SHA-256 of the revoked release's manifest> 2.1.0
// Root-Signature: <base64 signature by the root key>
//
// --- umbrelOS Root Key Handover ---
// ...
//
// Releases need signatures from Required-Signatures different approved keys, and devices refuse to
// install a revoked release however it's signed. Revoked-Release commits to exactly one release, by its
// manifest's hash, and anything after the hash, like its version, is a label for people. It's a signed block, so the root key signs
// every line above Root-Signature, and a list waiting for the root key has no Root-Signature yet.
//
// The list's handover blocks are the chain of root key handovers from the release's root key to the one
// that signed it, oldest first. Without any, the release's root key signed it. Other blocks are left for
// later schemas.
export function parseSigningKeysList(text: string) {
	const fail = (message: string) => new Error(`Approved signing keys list ${message}`)
	const [block, ...otherBlocks] = parseBlocks(text, {lenient: true})!
	if (block?.[0] !== SIGNING_KEYS_HEADER) throw fail('has an invalid header')
	const {messageLines, message, rootSignatures} = parseSignedBlock(block)

	const fields = parseFields(messageLines.slice(1), fail)

	const date = parseDate(fields.one('Date'))
	if (!date) throw fail('has an invalid date')

	const requiredSignatures = fields.one('Required-Signatures')
	if (!/^[1-9]\d{0,2}$/.test(requiredSignatures)) throw fail('has an invalid required-signatures')

	// Later schemas can add details after the public key, or keys this can't read, like another kind of
	// key, which this ignores as it can't verify their signatures anyway
	const keys = fields.all('Key').flatMap((value) => {
		const match = value.match(/^([A-Za-z0-9._-]+) (0[23][0-9a-f]{64})(?: \S+)*$/)
		return match && isSigningPublicKey(match[2]) ? [{name: match[1], publicKey: match[2]}] : []
	})
	const names = new Set(keys.map((key) => key.name))
	const publicKeys = new Set(keys.map((key) => key.publicKey))
	if (names.size !== keys.length || publicKeys.size !== keys.length) throw fail('has duplicate keys')

	// Later schemas can revoke releases in ways this can't read, like by another kind of hash, which it
	// ignores, like keys it can't read, so the rest of the list still counts
	const revokedReleases = fields.all('Revoked-Release').flatMap((value): RevokedRelease[] => {
		const match = value.match(/^sha256:([0-9a-f]{64})(?: (.+))?$/)
		return match ? [{manifest: match[1], ...(match[2] && {label: match[2]})}] : []
	})

	return {
		date,
		requiredSignatures: Number(requiredSignatures),
		keys,
		revokedReleases,
		handovers: otherBlocks
			.filter(([header]) => header === ROOT_KEY_HANDOVER_HEADER)
			.map((handoverBlock) => parseRootKeyHandover(handoverBlock)),
		message,
		rootSignatures,
	}
}

// The root key at the end of the chain of handovers from the release's root key. The first handover has
// to be from that key and every one has to be signed by the root key it hands over from, so every
// handover a device holds is verified.
export function followRootKeyHandovers(handovers: RootKeyHandover[], rootPublicKey = ROOT_PUBLIC_KEY) {
	let rootKey = rootPublicKey
	let previous: RootKeyHandover | undefined
	for (const handover of handovers) {
		if (handover.from !== rootKey || (previous && handover.date <= previous.date)) {
			throw new Error('Root key handovers are out of order')
		}
		if (!handover.rootSignatures.some((signature) => verifyBitcoinMessage(handover.message, signature, rootKey))) {
			throw new Error('Root key handover is not signed by the root key it hands over from')
		}
		rootKey = handover.to
		previous = handover
	}
	return rootKey
}

// Parse an approved signing keys list, accepting it only if the root key signed it, following any
// handovers from this release's root key. Its text is just its blocks, without any lines outside them a
// source added, so it's saved and carried in signature files as it was signed.
export function verifySigningKeysList(text: string, rootPublicKey = ROOT_PUBLIC_KEY): SigningKeysList {
	const {message, rootSignatures, ...list} = parseSigningKeysList(text)
	const rootKey = followRootKeyHandovers(list.handovers, rootPublicKey)
	if (!rootSignatures.some((signature) => verifyBitcoinMessage(message, signature, rootKey))) {
		throw new Error('Approved signing keys list is not signed by the root key')
	}
	return {...list, rootKey, text: formatBlocks(parseBlocks(text, {lenient: true})!)}
}

// Whether a list's handovers start with exactly the handovers of the list a device has, so its chain is
// the device's chain continued: any handovers after the device's have to be signed by the root key the
// device trusts now, and none of the device's can be swapped for another, or left out to replay one from
// before a root key was handed back.
const continuesHandovers = (list: SigningKeysList, from: SigningKeysList) =>
	from.handovers.every((handover, index) => list.handovers[index]?.message === handover.message)

// The most recently dated list, preferring the earlier one on a tie, out of those that continue the
// handovers of the device's own list, which comes first. Once a device has seen the root key handed
// over, the retired key can't sign lists or hand over to another key for it. A device that hasn't seen
// the handover trusts the retired key until it does, so hand over while the old key is safe, publish the
// handover straight away and put the new key in the next release.
export function newestSigningKeysList(lists: (SigningKeysList | undefined)[]) {
	const [current, ...others] = lists.filter((list) => list !== undefined)
	if (!current) return undefined
	return others
		.filter((list) => continuesHandovers(list, current))
		.reduce((newest, list) => (list.date > newest.date ? list : newest), current)
}

// DER prefix of a P-256 SubjectPublicKeyInfo holding a 33 byte compressed point
const P256_SPKI_PREFIX = Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex')

const signingPublicKey = (publicKey: string) =>
	crypto.createPublicKey({
		key: Buffer.concat([P256_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
		format: 'der',
		type: 'spki',
	})

// Whether hex is a compressed P-256 public key, a point on the curve
function isSigningPublicKey(publicKey: string) {
	try {
		signingPublicKey(publicKey)
		return true
	} catch {
		return false
	}
}

// Verify a signer's signature of a message: ECDSA over P-256 with SHA-256, as the 64 bytes of r and s in
// base64, of the message after SIGNER_MESSAGE_PREFIX
export function verifySignerSignature(message: string, signature: string, publicKey: string) {
	try {
		const signatureBytes = Buffer.from(signature, 'base64')
		if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== signature) return false
		return crypto.verify(
			'sha256',
			Buffer.from(`${SIGNER_MESSAGE_PREFIX}${message}`, 'utf8'),
			{key: signingPublicKey(publicKey), dsaEncoding: 'ieee-p1363'},
			signatureBytes,
		)
	} catch {
		return false
	}
}

// What's signed of a file: its text without whitespace at its ends, since wallets can trim the message they
// sign
const signedText = (text: string) => text.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '')

// The message signers sign for a release: its manifest
export const formatManifestMessage = (manifest: string) => signedText(manifest)

// The message signers sign for a release's notes, which says which release they're for, so they can't be
// shown with another one:
//
// --- umbrelOS Release Notes ---
// Schema: 1
// Version: 2.1.0
//
// <release-notes.md>
export const formatReleaseNotesMessage = (version: string, releaseNotes: string) =>
	signedText([RELEASE_NOTES_HEADER, `Schema: ${SCHEMA}`, `Version: ${version}`, '', releaseNotes].join('\n'))

export function formatSignatureFile({
	signingKeysList,
	signatures,
	rootSignatures = [],
}: {
	signingKeysList: string
	signatures: ReleaseSignature[]
	rootSignatures?: string[]
}) {
	// Rather than leave the list out, which devices without it would need to verify the signers
	const listBlocks = parseBlocks(signingKeysList)
	if (!listBlocks) {
		throw new Error("The approved signing keys list has lines outside its blocks, so it can't be included")
	}
	return [formatSignedBlock(SIGNATURES_HEADER, {rootSignatures, signatures}), formatBlocks(listBlocks)].join('\n')
}

// Read a signature file, manifest.txt.sig or release-notes.md.sig: each signer's signature under the name
// of the approved key it's from, or in an emergency, like every signing key being lost, the root key's
// signature, then the approved signing keys list the signers were approved by.
//
// --- umbrelOS Signatures ---
// Signature: lukechilds-mbp-2026 <base64 signature>
// Root-Signature: <base64 signature by the root key, in an emergency>
//
// --- umbrelOS Signing Keys ---
// ...
//
// The list is only used if it's signed by the root key. Without it the device's own lists still approve
// signers. Blocks this doesn't recognise, or can't read, are left for later formats.
export function readSignatureFile(text: string, rootPublicKey = ROOT_PUBLIC_KEY) {
	const blocks = parseBlocks(text, {lenient: true})!
	const signaturesBlock = blocks.find(([header]) => header === SIGNATURES_HEADER)
	const {signatures, rootSignatures} = signaturesBlock
		? parseSignedBlock(signaturesBlock)
		: {signatures: [] as ReleaseSignature[], rootSignatures: [] as string[]}
	const keysBlock = blocks.find(([header]) => header === SIGNING_KEYS_HEADER)
	const listBlocks = keysBlock ? [keysBlock, ...blocks.filter(([header]) => header === ROOT_KEY_HANDOVER_HEADER)] : []

	try {
		const signingKeys = verifySigningKeysList(formatBlocks(listBlocks), rootPublicKey)
		return {signingKeys, signatures, rootSignatures}
	} catch (error) {
		return {signingKeys: undefined, signingKeysError: error as Error, signatures, rootSignatures}
	}
}

// Check a message has as many signatures from different approved keys as the list requires, or a
// signature from the root key the list was signed by. Each signature is checked against the approved key
// it's filed under, so it can't count for another. Returns the keys that signed it.
export async function verifySignatures(
	message: string,
	{signatures, rootSignatures}: Signatures,
	{keys, requiredSignatures, rootKey}: Pick<SigningKeysList, 'keys' | 'requiredSignatures' | 'rootKey'>,
) {
	if (rootSignatures.some((signature) => verifyBitcoinMessage(message, signature, rootKey))) {
		return {signers: [] as SigningKey[], signedByRootKey: true}
	}
	if (signatures.length === 0) {
		throw new ReleaseVerificationError(
			rootSignatures.length > 0
				? 'This release has an invalid signature from the root key'
				: "This release isn't signed",
		)
	}

	const signers: SigningKey[] = []
	const problems: ReleaseVerificationError[] = []
	// So a long file of bad signatures can't be checked over and over
	for (const {name, signature} of signatures.slice(0, MAX_SIGNATURES)) {
		const key = keys.find((key) => key.name === name)
		// The name isn't repeated, since it isn't signed
		if (!key) problems.push(new ReleaseVerificationError("This release is signed by a key that isn't approved"))
		else if (signers.includes(key)) continue
		else if (verifySignerSignature(message, signature, key.publicKey)) signers.push(key)
		else problems.push(new ReleaseVerificationError(`This release has an invalid signature from ${key.name}`))
	}

	if (signers.length < requiredSignatures) {
		// A release needing one signature that has one says what's wrong with it
		if (requiredSignatures === 1 && signatures.length === 1) throw problems[0]
		throw new ReleaseVerificationError(
			`This release has ${signers.length} of the ${requiredSignatures} signatures it needs from approved keys`,
			{cause: new AggregateError(problems)},
		)
	}
	return {signers, signedByRootKey: false}
}

// Check a release's manifest is signed, and that the list hasn't revoked it, then its release notes. Returns
// the release, the keys that signed it, and its release notes if they're signed for it, or otherwise none
// and why, since a release installs without its notes.
export async function verifyRelease({
	manifest,
	manifestSignatures,
	releaseNotes,
	releaseNotesSignatures,
	signingKeys,
}: {
	manifest: string
	manifestSignatures: Signatures
	releaseNotes?: string
	releaseNotesSignatures?: Signatures
	signingKeys: Pick<SigningKeysList, 'keys' | 'requiredSignatures' | 'rootKey' | 'revokedReleases'>
}) {
	// Signatures don't cover whitespace at the ends, since wallets can trim it, so a manifest has to be
	// exactly its signed text and the newline it ends with. Anything else there would change what the device
	// parses, or the hash a revocation matches, without breaking its signatures.
	if (manifest !== `${formatManifestMessage(manifest)}\n`) {
		throw new ReleaseVerificationError('The release manifest is malformed')
	}
	const {signers, signedByRootKey} = await verifySignatures(
		formatManifestMessage(manifest),
		manifestSignatures,
		signingKeys,
	)
	// Only once it's verified, so errors don't repeat unsigned text
	const release = parseReleaseManifest(manifest)
	const hash = sha256(manifest).toString('hex')
	if (signingKeys.revokedReleases.some((revoked) => revoked.manifest === hash)) {
		throw new ReleaseVerificationError(`umbrelOS ${release.version} has been revoked`)
	}

	let notes = ''
	let releaseNotesError: Error | undefined
	try {
		if (releaseNotes === undefined || !releaseNotesSignatures) throw new Error('This release has no release notes')
		await verifySignatures(
			formatReleaseNotesMessage(release.version, releaseNotes),
			releaseNotesSignatures,
			signingKeys,
		)
		// Only what was signed, without the whitespace at the end that signatures don't cover
		notes = releaseNotes.replace(/[\x00-\x20]+$/, '')
	} catch (error) {
		releaseNotesError = error as Error
	}
	return {...release, releaseNotes: notes, releaseNotesError, signers, signedByRootKey}
}

// Parse a release manifest. It pins every file in the release by its SHA-256, and each update bundle
// also by its Rugix bundle hash, which `rugix-ctrl update install --bundle-hash` checks as the bundle
// streams in, and the boot flow and architecture of the devices it's for. A file can be the release's
// update script, which devices run to install it.
//
// --- umbrelOS Manifest ---
// Schema: 1
// Version: 2.1.0
// Name: umbrelOS 2.1
// Date: 2026-11-04T12:00:00Z
// Commit: <the Git commit it was built from, which devices don't use>
// Docker-Image: ghcr.io/getumbrel/umbrelos@sha256:<hex>
// File: umbrelos-amd64.img.xz sha256:<hex>
// File: umbrelos-amd64.update sha256:<hex> bundle:sha512-256:<hex> boot-flow:grub arch:amd64
// File: update.sh sha256:<hex> type:update-script
export function parseReleaseManifest(text: string): ReleaseManifest {
	const fail = (message: string) => new ReleaseVerificationError(`The release manifest ${message}`)

	const [header, ...fieldLines] = text.split('\n')
	if (header !== MANIFEST_HEADER || fieldLines.pop() !== '') throw fail('is malformed')
	const fields = parseFields(fieldLines, fail)

	const version = fields.one('Version')
	if (semver.valid(version) !== version) throw fail('has an invalid version')

	const name = fields.one('Name')
	if (!/^\S/.test(name)) throw fail('has an invalid name')

	// The time of the commit the release was built from. It's only informational: the OpenTimestamps proof
	// is what shows when the manifest existed.
	const date = parseDate(fields.one('Date'))
	if (!date) throw fail('has an invalid date')

	// Devices don't use it, so a manifest without a valid one is fine
	const dockerImages = fields.all('Docker-Image')
	if (dockerImages.length > 1) throw fail('has an invalid docker-image')
	const dockerImage = dockerImages.find((image) => /^[a-z0-9.-]+(\/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$/.test(image))

	// A file's name and its details, in the manifest's order. Later schemas can add other details, which
	// this ignores, and files this can't read, like ones in a directory, which this leaves out. A detail
	// given twice is refused rather than guessed at.
	const files: Record<string, ReleaseFile> = Object.create(null)
	for (const value of fields.all('File')) {
		const [file, ...details] = value.split(' ')
		const values = (name: string) =>
			details.filter((detail) => detail.startsWith(`${name}:`)).map((detail) => detail.slice(name.length + 1))
		const [sha256] = values('sha256')
		const [bundle] = values('bundle')
		const [bootFlow] = values('boot-flow')
		const [arch] = values('arch')
		const [type] = values('type')
		if (
			!/^[A-Za-z0-9._+-]+$/.test(file) ||
			!/^[0-9a-f]{64}$/.test(sha256 ?? '') ||
			(bundle !== undefined && !/^[a-z0-9-]+:[0-9a-f]+$/.test(bundle)) ||
			[bootFlow, arch, type].some((value) => value !== undefined && !/^[a-z0-9-]+$/.test(value))
		) {
			continue
		}
		const repeated = ['sha256', 'bundle', 'boot-flow', 'arch', 'type'].some((name) => values(name).length > 1)
		if (Object.hasOwn(files, file) || repeated) throw fail('has an invalid file')
		files[file] = {
			sha256,
			...(bundle && {bundle}),
			...(bootFlow && {bootFlow}),
			...(arch && {arch}),
			...(type && {type}),
		}
	}

	return {version, name, date, ...(dockerImage && {dockerImage}), files}
}

// The release notes a device shows. They can have sections for devices updating from particular versions,
// each after a line like <!-- umbrelOS from 2.0.x --> or <!-- umbrelOS from >=1.4.1 <1.5.0 --> with a
// semver range. A device shows the first section whose range has its installed version, or otherwise
// everything before the first section. Markdown hides the lines, so the file still reads as one document.
// A section whose range this can't read is left for later versions.
export function selectReleaseNotes(releaseNotes: string, installedVersion: string) {
	const lines = releaseNotes.split('\n')
	const sections = lines.flatMap((line, index) => {
		const range = line.match(/^<!-- umbrelOS from (.+) -->$/)?.[1]
		return range ? [{range, index}] : []
	})
	const text = (start: number, end = lines.length) =>
		lines
			.slice(start, end)
			.join('\n')
			.replace(/^\n+|\n+$/g, '')
	const section = sections.findIndex(
		({range}) => semver.validRange(range) && semver.satisfies(installedVersion, range, {includePrerelease: true}),
	)
	if (section === -1) return text(0, sections[0]?.index)
	return text(sections[section].index + 1, sections[section + 1]?.index)
}

// The update bundle a device installs from a release: the first one in the manifest for its boot flow
// and architecture. A later version could prefer a more specific bundle, like one for a single kind of
// hardware, which it lists after the bundle older devices should install.
export function findUpdateBundle(release: ReleaseManifest, device: {bootFlow?: string; arch: string}) {
	const found = Object.entries(release.files).find(
		([, file]) => file.bundle && file.bootFlow === device.bootFlow && file.arch === device.arch,
	)
	return found && {name: found[0], bundleHash: found[1].bundle!}
}

// The update script a device runs to install a release, if it has one: the first one in the manifest
// without a boot flow or architecture, or with the device's
export function findUpdateScript(release: ReleaseManifest, device: {bootFlow?: string; arch: string}) {
	const found = Object.entries(release.files).find(
		([, file]) =>
			file.type === 'update-script' &&
			(file.bootFlow === undefined || file.bootFlow === device.bootFlow) &&
			(file.arch === undefined || file.arch === device.arch),
	)
	return found && {name: found[0], sha256: found[1].sha256}
}

// The most devices download of a release manifest, release signature, keys list or update server
// response, so a hostile server can't exhaust memory
export const DOWNLOAD_SIZE_LIMIT = 1024 * 1024

// Read a response body, refusing more than the limit so a hostile server can't exhaust memory
export async function readBody(response: Response, limit = DOWNLOAD_SIZE_LIMIT) {
	const chunks: Uint8Array[] = []
	let size = 0
	const reader = response.body?.getReader()
	while (reader) {
		const {done, value} = await reader.read()
		if (done) break
		size += value.length
		if (size > limit) {
			await reader.cancel()
			throw new Error(`${response.url} is over ${limit} bytes`)
		}
		chunks.push(value)
	}
	return Buffer.concat(chunks)
}

export const readText = async (response: Response, limit?: number) => (await readBody(response, limit)).toString('utf8')

// Resolve a file in a release directory
export function releaseFileUrl(releaseUrl: string, file: string) {
	return new URL(file, releaseUrl.endsWith('/') ? releaseUrl : `${releaseUrl}/`).href
}

// A release's directory from a URL for it, which can also be one of its files', like
// https://download.umbrel.com/public-test-build or https://download.umbrel.com/release/2.1.0/release.sig
export function releaseDirectoryUrl(url: string) {
	const parsed = new URL(url)
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		// The URL can come from the update server, so it isn't repeated in a message the user sees
		throw new ReleaseVerificationError("The release URL isn't an HTTP or HTTPS URL")
	}
	parsed.search = ''
	parsed.hash = ''
	parsed.pathname = parsed.pathname
		.replace(
			new RegExp(
				`/(${[MANIFEST_FILE, MANIFEST_SIGNATURE_FILE, RELEASE_NOTES_FILE, RELEASE_NOTES_SIGNATURE_FILE].join('|')})$`,
			),
			'',
		)
		.replace(/\/?$/, '/')
	return parsed.href
}

// A file from a release's directory, or undefined if it doesn't have it
async function downloadReleaseFile(releaseUrl: string, file: string, userAgent: string) {
	const url = releaseFileUrl(releaseUrl, file)
	const response = await fetch(url, {headers: {'User-Agent': userAgent}, signal: AbortSignal.timeout(60_000)})
	if (response.status === 404) return undefined
	if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
	return readText(response)
}

export async function downloadReleaseManifest(releaseUrl: string, userAgent: string) {
	const manifest = await downloadReleaseFile(releaseUrl, MANIFEST_FILE, userAgent)
	if (manifest === undefined) throw new ReleaseVerificationError("This release doesn't have a manifest")
	return manifest
}

export async function downloadManifestSignature(releaseUrl: string, userAgent: string) {
	const signatureFile = await downloadReleaseFile(releaseUrl, MANIFEST_SIGNATURE_FILE, userAgent)
	if (signatureFile === undefined) throw new ReleaseVerificationError("This release isn't signed")
	return signatureFile
}

// A release's notes and their signatures, which it can do without
export async function downloadReleaseNotes(releaseUrl: string, userAgent: string) {
	const [releaseNotes, signatureFile] = await Promise.all([
		downloadReleaseFile(releaseUrl, RELEASE_NOTES_FILE, userAgent),
		downloadReleaseFile(releaseUrl, RELEASE_NOTES_SIGNATURE_FILE, userAgent),
	])
	return {releaseNotes, signatureFile}
}
