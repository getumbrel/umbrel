// Tools for umbrelOS release signers, run with ./scripts/release-signing <command> from the repo root.
// See source/modules/update/release-signing.ts for how devices verify releases.
//
// Signers each have a key their Mac's Secure Enclave created with `provision`, which can't leave it and
// needs Touch ID with a finger enrolled when it was made to sign (see scripts/secure-enclave-key.swift).
// Apple doesn't attest keys, so nothing can prove to anyone else that an approved key is one. Provisioning or revoking a key, or changing how many signers a
// release needs, changes the bundled approved keys list and leaves it unsigned, so CI fails until the
// root key holder signs it with `sign-keys-list`.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'

import {$} from 'execa'

import {
	BUNDLED_SIGNING_KEYS_PATH,
	DOWNLOAD_SIZE_LIMIT,
	MANIFEST_FILE,
	MANIFEST_SIGNATURE_FILE,
	RELEASE_NOTES_FILE,
	RELEASE_NOTES_SIGNATURE_FILE,
	ROOT_PUBLIC_KEY,
	SIGNING_KEYS_URLS,
	followRootKeyHandovers,
	formatManifestMessage,
	formatReleaseNotesMessage,
	formatRootKeyHandoverMessage,
	formatSignatureFile,
	formatSigningKeysList,
	formatSigningKeysListMessage,
	newestSigningKeysList,
	parseReleaseManifest,
	parseSigningKeysList,
	readSignatureFile,
	releaseDirectoryUrl,
	releaseFileUrl,
	verifyBitcoinMessage,
	verifyRelease,
	verifySignerSignature,
	verifySigningKeysList,
	type ReleaseSignature,
	type RevokedRelease,
	type SigningKey,
	type SigningKeysList,
} from '../source/modules/update/release-signing.ts'

const usage = `
    Usage
        $ ./scripts/release-signing <command>

    Commands
        list-keys                         Show this Mac's signing key and whether it's approved
        provision <name>                  Create a signing key on this Mac and add it to the approved keys list
        delete-key                        Delete this Mac's signing key, to provision a new one
        revoke <name>                     Remove a signing key from the approved keys list
        require-signatures <count>        Set how many approved signers each release needs
        revoke-release <manifest>         Stop devices installing a signed release, given its manifest's
                                          URL or path, like releases/2.1.0-manifest.txt
        sign-keys-list                    Sign the approved keys list with the root key in Sparrow
        hand-over-root <public key>       Hand the root key over to a new hardware wallet's key
        sign <release>                    Sign a release's manifest and release notes with this Mac's
                                          signing key, adding to any signatures they already have
        root-sign <release>               Sign a release with the root key alone, for emergencies
        verify <release>                  Check a release the way a device does

    A release is its directory on the download server, like https://download.umbrel.com/release/2.1.0/ for
    a production release or https://download.umbrel.com/<tag>/ for a test build, or a local directory
    holding its manifest.txt and release-notes.md and their signatures, manifest.txt.sig and
    release-notes.md.sig.

    Commands never wait for input, so they can be run by an agent: one that signs or deletes something
    first shows what it would do and how to confirm it, and does it when run again with that.

    Options
        --confirm <code>                  sign: sign what it showed, given the confirmation code it printed.
                                          delete-key: delete the key, given the key it showed.
        --signature <signature>           sign-keys-list, hand-over-root, root-sign: the root key's
                                          signature of the message it showed, from Sparrow. root-sign: of
                                          the manifest.
        --release-notes-signature <sig>   root-sign: the root key's signature of the release notes
        --date <date>                     sign-keys-list, hand-over-root: the date the message it showed
                                          has, which the signature covers
        --release-notes <file>            sign, root-sign: sign only these release notes, like to fix
                                          them. verify: check them instead of the release's.
        --files <directory>               verify: also check downloaded release files against the manifest
`

// This Mac's signing key, wrapped: the Secure Enclave's encrypted form of it, which only this Mac's Secure
// Enclave can decrypt, inside it. It's saved under this name whatever the signer is called.
const SIGNING_KEY_PATH = path.join(
	os.homedir(),
	'Library/Application Support/umbrelOS Release Signing/wrapped-signing-key',
)
// The helper that creates and signs with Secure Enclave keys, built on first use with the Swift compiler in
// Xcode's command line tools
const SECURE_ENCLAVE_HELPER_SOURCE = fileURLToPath(new URL('./secure-enclave-key.swift', import.meta.url))
const SECURE_ENCLAVE_HELPER_CACHE = path.join(os.homedir(), 'Library/Caches/umbrelos-release-signing')

// Every signed production release's manifest, timestamp, release notes and signatures, kept in the repo as
// a public record of what was signed, like releases/2.1.0-manifest.txt. They're named by version since
// the manifest says which release it is, and signatures and timestamps cover contents rather than names.
// releases/README.md describes adding a release.
export const ARCHIVE_DIRECTORY = fileURLToPath(new URL('../../../releases/', import.meta.url))

// The latest approved signing keys list, at a path that never moves since devices fetch it from the
// public repo on GitHub
export const PUBLISHED_SIGNING_KEYS_PATH = path.join(ARCHIVE_DIRECTORY, 'umbrelos-signing-keys.txt')

// Every approved signing keys list the root key signed, named by its date like
// 20261022T201438Z-umbrelos-signing-keys.txt so they sort in order
export const KEYS_ARCHIVE_DIRECTORY = path.join(ARCHIVE_DIRECTORY, 'keys')
export const archivedSigningKeysListName = (date: Date) =>
	`${date
		.toISOString()
		.replace(/\.\d{3}Z$/, 'Z')
		.replace(/[-:]/g, '')}-umbrelos-signing-keys.txt`

const isUrl = (source: string) => /^https?:\/\//.test(source)

// A release file's other files are found by adding to its URL, like .sig, so a query string or fragment
// would point them somewhere else
function checkUrl(url: string) {
	const {search, hash} = new URL(url)
	if (search || hash) throw new Error(`Give ${url} without its ${search ? 'query string' : 'fragment'}`)
}

async function readBytes(source: string) {
	if (!isUrl(source)) return fs.readFile(source)
	checkUrl(source)
	const response = await fetch(source)
	if (!response.ok) throw new Error(`Failed to download ${source}: HTTP ${response.status}`)
	return Buffer.from(await response.arrayBuffer())
}

const read = async (source: string) => (await readBytes(source)).toString('utf8')

// Read a file or URL that might not exist yet. It's decoded as devices do, keeping a byte order mark that
// response.text() would drop, so what's signed and verified here is what devices read.
async function readIfExists(source: string) {
	if (isUrl(source)) {
		checkUrl(source)
		const response = await fetch(source)
		if (response.status === 404) return undefined
		if (!response.ok) throw new Error(`Failed to download ${source}: HTTP ${response.status}`)
		return Buffer.from(await response.arrayBuffer()).toString('utf8')
	}
	return fs.readFile(source, 'utf8').catch((error) => {
		if (error.code === 'ENOENT') return undefined
		throw error
	})
}

const sha256 = (data: crypto.BinaryLike) => crypto.createHash('sha256').update(data).digest('hex')

// Run the Secure Enclave helper, building it first if this version of it isn't built yet
async function secureEnclaveKey(
	command: 'create' | 'public-key' | 'sign',
	keyFile: string,
	{input, reason}: {input?: string; reason?: string} = {},
) {
	if (process.platform !== 'darwin') throw new Error('Signing keys live in the Secure Enclave of a Mac')
	const source = await fs.readFile(SECURE_ENCLAVE_HELPER_SOURCE)
	// Each version of it in a directory of its own, under a name macOS shows in Touch ID's dialog
	const helper = path.join(SECURE_ENCLAVE_HELPER_CACHE, sha256(source).slice(0, 16), 'umbrelOS Release Signing')
	if (!(await fs.stat(helper).catch(() => undefined))) {
		await fs.mkdir(path.dirname(helper), {recursive: true})
		const building = `${helper}.${process.pid}`
		await $`swiftc -O ${SECURE_ENCLAVE_HELPER_SOURCE} -o ${building}`.catch((error) => {
			throw new Error(
				`Couldn't build the Secure Enclave helper. Install Xcode's command line tools with xcode-select --install.\n${error.stderr ?? ''}`,
			)
		})
		await fs.rename(building, helper)
	}
	const {stdout} = await $({input})`${helper} ${command} ${keyFile} ${reason ? [reason] : []}`.catch((error) => {
		throw new Error(error.stderr?.trim() || error.message)
	})
	return stdout.trim()
}

const tool = (command: string) => `./scripts/release-signing ${command}`

// What to do about a signing key that can't be used any more, like after Touch ID's fingers changed
const replaceKeySteps = `Delete it with ${tool('delete-key')}, create a new one with ${tool('provision <name>')} and ask the root key holder to approve it with ${tool('sign-keys-list')}.`

// This Mac's signing key's public key, or undefined if it has none
async function signingPublicKey(keyFile = SIGNING_KEY_PATH) {
	if (!(await fs.stat(keyFile).catch(() => undefined))) return undefined
	return secureEnclaveKey('public-key', keyFile).catch((error) => {
		throw new Error(`This Mac's signing key at ${keyFile} can't be used: ${error.message}\n${replaceKeySteps}`)
	})
}

// The newest valid list from the bundled copy, every published source and any others, like a device
async function findSigningKeys(others: (SigningKeysList | undefined)[] = []) {
	const lists = await Promise.all(
		[BUNDLED_SIGNING_KEYS_PATH, ...SIGNING_KEYS_URLS].map((source) =>
			read(source)
				.then((text) => verifySigningKeysList(text))
				.catch((error) => {
					console.warn(`Skipping ${source}: ${error.message}`)
					return undefined
				}),
		),
	)
	const newest = newestSigningKeysList([...lists, ...others])
	if (!newest) throw new Error('No valid approved signing keys list found')
	return newest
}

type ListChange = {keys: SigningKey[]; requiredSignatures: number; revokedReleases: RevokedRelease[]}

// Write the bundled list with a change, unsigned until the root key holder signs it
async function updateKeysList(change: (list: ListChange) => Partial<ListChange>) {
	const {keys, requiredSignatures, revokedReleases, handovers} = parseSigningKeysList(
		await fs.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8'),
	)
	const list = {
		keys,
		requiredSignatures,
		revokedReleases,
		handovers,
		...change({keys, requiredSignatures, revokedReleases}),
	}
	if (list.requiredSignatures > list.keys.length) {
		console.warn(
			`\nReleases need ${list.requiredSignatures} signatures but only ${list.keys.length} keys are approved, so no release can be installed.`,
		)
	}
	await fs.writeFile(BUNDLED_SIGNING_KEYS_PATH, formatSigningKeysList({date: new Date(), ...list, rootSignatures: []}))
	console.log(
		`\nUpdated ${path.relative(process.cwd(), BUNDLED_SIGNING_KEYS_PATH)}. Commit it and open a pull request.`,
	)
	console.log("CI fails until it's signed with the root key, using ./scripts/release-signing sign-keys-list.")
}

// Hand the root key over to a new hardware wallet's key, like before retiring the current one. The current
// root key signs the handover, and the list then needs signing with the new key. Without the signature it
// shows the handover to sign.
async function handOverRoot(newRootKey: string, {signature, date: dateString}: RootSignatureOptions = {}) {
	if (!/^0[23][0-9a-f]{64}$/.test(newRootKey)) {
		throw new Error(
			"Give the new root key as a compressed public key in hex, like the one in the wallet's output descriptor",
		)
	}
	const list = verifySigningKeysList(await fs.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8'))
	if (newRootKey === list.rootKey) throw new Error("That's already the root key")

	const date = signedDate(dateString, list.date, ...list.handovers.map((handover) => handover.date))
	const message = formatRootKeyHandoverMessage({date, from: list.rootKey, to: newRootKey})
	if (!signature) {
		printRootSigningSteps(list.rootKey, message)
		console.log('Then save the handover with the signature:')
		console.log(`  ${tool(`hand-over-root ${newRootKey} --date ${formatDate(date)} --signature <signature>`)}`)
		return
	}
	if (!verifyBitcoinMessage(message, signature, list.rootKey)) {
		throw new Error(`That isn't a signature of the handover by the root key ${list.rootKey}`)
	}

	await fs.writeFile(
		BUNDLED_SIGNING_KEYS_PATH,
		formatSigningKeysList({
			...list,
			date,
			rootSignatures: [],
			handovers: [...list.handovers, {message, rootSignatures: [signature]}],
		}),
	)
	console.log(
		`\nHanded the root key over to ${newRootKey} in ${path.relative(process.cwd(), BUNDLED_SIGNING_KEYS_PATH)}.`,
	)
	console.log('Sign the list with the new root key using ./scripts/release-signing sign-keys-list, then commit')
	console.log("and publish it. CI fails until it's signed. Devices accept lists from the old root key until they")
	console.log('see the handover, so keep the old hardware wallet safe until the list is published.')
	console.log('\nLeave ROOT_PUBLIC_KEY as it is: every list carries the chain of handovers from it, which devices')
	console.log('follow to the new key.')
}

// Whether the bundled list approves a key, or an earlier root-signed list did, and what to do about it if
// it can't sign yet
async function keyStatus(publicKey: string) {
	const {keys, rootSignatures} = parseSigningKeysList(await fs.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8'))
	const approved = keys.find((key) => key.publicKey === publicKey)
	if (approved) {
		if (rootSignatures.length > 0) return {approved, description: `approved as ${approved.name}`}
		return {
			approved,
			description: `approved as ${approved.name}, once the root key signs the list`,
			advice: `Commit the bundled list and ask the root key holder to sign it with ${tool('sign-keys-list')}.`,
		}
	}

	const archived = await fs.readdir(KEYS_ARCHIVE_DIRECTORY).catch(() => [])
	for (const file of archived.sort().reverse()) {
		const list = parseSigningKeysList(await fs.readFile(path.join(KEYS_ARCHIVE_DIRECTORY, file), 'utf8'))
		const revoked = list.keys.find((key) => key.publicKey === publicKey)
		if (revoked) {
			return {
				revoked,
				description: `revoked, it was approved as ${revoked.name}`,
				advice: `${tool('delete-key')} deletes it, then ${tool('provision <name>')} creates a new one for the root key holder to approve.`,
			}
		}
	}
	return {
		description: "not approved, it isn't in the bundled keys list",
		advice: `Check out the branch that approves it, or ${replaceKeySteps.charAt(0).toLowerCase()}${replaceKeySteps.slice(1)}`,
	}
}

async function listKeys() {
	const publicKey = await signingPublicKey()
	if (!publicKey) {
		console.log(`This Mac has no signing key. Create one with ${tool('provision <name>')}`)
		return
	}
	const {description, advice} = await keyStatus(publicKey)
	console.log(`${publicKey}  ${description}`)
	console.log(`Saved, wrapped by the Secure Enclave, at ${SIGNING_KEY_PATH}`)
	if (advice) console.log(advice)
}

async function provision(name: string) {
	if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('Names can only contain letters, numbers, ".", "_" and "-"')

	// One signing key per Mac, so a new one is always a new key rather than one approved or revoked before
	const existing = await signingPublicKey()
	if (existing) {
		throw new Error(
			`This Mac already has a signing key, ${existing}, ${(await keyStatus(existing)).description}. Delete it first with ${tool('delete-key')}`,
		)
	}
	const {keys} = parseSigningKeysList(await fs.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8'))
	if (keys.some((key) => key.name === name)) throw new Error(`There's already an approved key called ${name}`)

	console.log('Creating a signing key in the Secure Enclave. Signing with it will need Touch ID.')
	const publicKey = await secureEnclaveKey('create', SIGNING_KEY_PATH)
	console.log(`Saved the signing key ${publicKey}, wrapped by the Secure Enclave, to ${SIGNING_KEY_PATH}`)
	console.log(
		"Only this Mac's Secure Enclave can use it, so it can't be restored to another Mac, and adding or removing a Touch ID fingerprint makes it unusable. Either way, provision a new one.",
	)

	await updateKeysList(({keys}) => ({keys: [...keys, {name, publicKey}]}))
}

// The Secure Enclave keeps nothing of a key, so deleting its key file deletes the key. Without confirm it
// shows the key and how to confirm deleting it: with its public key, or for a key it can't read, like
// after Touch ID's fingers changed, the SHA-256 of its key file.
async function deleteKey({confirm}: {confirm?: string} = {}) {
	const keyFile = await fs.readFile(SIGNING_KEY_PATH).catch(() => undefined)
	if (!keyFile) throw new Error('This Mac has no signing key')
	const publicKey = await signingPublicKey().catch(() => undefined)
	const key = publicKey ?? sha256(keyFile)

	const status = publicKey
		? await keyStatus(publicKey)
		: {description: "unusable, like after Touch ID's fingers changed"}
	if (confirm !== key) {
		if (confirm !== undefined) throw new Error(`That isn't this Mac's signing key, ${key}`)
		console.log(`${publicKey ?? `${SIGNING_KEY_PATH} (SHA-256 ${key})`}  ${status.description}`)
		console.log("To delete it, which can't be undone:")
		console.log(`  ${tool(`delete-key --confirm ${key}`)}`)
		return
	}

	await fs.rm(SIGNING_KEY_PATH)
	console.log(`Deleted ${SIGNING_KEY_PATH}`)
	if ('approved' in status && status.approved) {
		console.log(`\n${status.approved.name} is still approved. Revoke it with ${tool(`revoke ${status.approved.name}`)}`)
	}
}

async function revoke(name: string) {
	await updateKeysList(({keys}) => {
		if (!keys.some((key) => key.name === name)) throw new Error(`${name} isn't an approved signing key`)
		return {keys: keys.filter((key) => key.name !== name)}
	})
}

async function requireSignatures(count: string) {
	if (!/^[1-9]\d{0,2}$/.test(count)) throw new Error('The count has to be a whole number from 1')
	await updateKeysList(() => ({requiredSignatures: Number(count)}))
}

// Revoke a signed release, like one that breaks devices, so devices refuse it whoever signed it. It's
// revoked by the hash of the manifest file given, like the archived copy in releases/, so only that exact
// release is, labelled with its version for people.
async function revokeRelease(source: string) {
	const manifest = await read(source)
	// Devices only accept a manifest that's exactly its signed text, so the hash of anything else would
	// never match the release they're offered
	if (manifest !== `${formatManifestMessage(manifest)}\n`) {
		throw new Error(`${source} isn't a release manifest devices would accept`)
	}
	const {name, version} = parseReleaseManifest(manifest)
	const revoked = {manifest: sha256(manifest), label: version}
	await updateKeysList(({revokedReleases}) => {
		if (revokedReleases.some((release) => release.manifest === revoked.manifest)) {
			throw new Error(`${version} is already revoked`)
		}
		console.log(`Revoking ${showHidden(name)} (${version}), whose manifest's SHA-256 is ${revoked.manifest}`)
		return {revokedReleases: [...revokedReleases, revoked]}
	})
}

// Sparrow's steps for signing a message with a root key's hardware wallet
function printRootSigningSteps(rootKey: string, message: string) {
	console.log(`In Sparrow, open the wallet of the root key ${rootKey} and go to Tools > Sign/Verify`)
	console.log('Message. Select the root address, paste in this message exactly, pick the Standard (Electrum) or')
	console.log('BIP137 format and sign it with the hardware wallet.\n')
	console.log(showHidden(message))
	console.log()
}

// Now, to the second as lists are, or just after a date if that's later, like one set by a computer
// with its clock ahead, since devices ignore lists dated before the newest they've seen
function dateAfter(...dates: Date[]) {
	const date = new Date(Math.floor(Date.now() / 1000) * 1000)
	const latest = Math.max(...dates.map((other) => other.getTime()))
	if (date.getTime() > latest) return date
	console.warn(`The last list is dated in the future, at ${new Date(latest).toISOString()}, so this follows it.`)
	return new Date(latest + 1000)
}

const formatDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

// The date a message to sign has: a new one, or given the date a message that was shown has, that date,
// which still has to follow the others
function signedDate(dateString: string | undefined, ...after: Date[]) {
	if (dateString === undefined) return dateAfter(...after)
	const date = new Date(dateString)
	if (Number.isNaN(date.getTime()) || formatDate(date) !== dateString) {
		throw new Error(`Give the date as it was shown, like 2026-11-03T10:00:00Z: ${dateString}`)
	}
	if (after.some((other) => date <= other)) throw new Error(`${dateString} doesn't follow the last list or handover`)
	return date
}

type RootSignatureOptions = {signature?: string; date?: string}

// Sign the bundled list with the root key. Without the signature it shows the message to sign.
async function signKeysList({signature, date: dateString}: RootSignatureOptions = {}) {
	const {keys, requiredSignatures, revokedReleases, handovers} = parseSigningKeysList(
		await fs.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8'),
	)
	// The root key at the end of the list's handovers, like the new one after a handover
	const rootKey = followRootKeyHandovers(handovers)

	const previous = await findSigningKeys().catch(() => undefined)
	// Devices only take a list whose handovers start with exactly the ones of the list they have
	if (previous && !previous.handovers.every((handover, index) => handovers[index]?.message === handover.message)) {
		throw new Error(
			"Its handovers don't continue the published list's, so devices wouldn't take it. Start from the published list's handovers.",
		)
	}
	const date = signedDate(
		dateString,
		...(previous ? [previous.date] : []),
		...handovers.map((handover) => handover.date),
	)
	const message = formatSigningKeysListMessage({date, requiredSignatures, keys, revokedReleases})
	if (!signature) {
		printRootSigningSteps(rootKey, message)
		console.log('Then save the list with the signature:')
		console.log(`  ${tool(`sign-keys-list --date ${formatDate(date)} --signature <signature>`)}`)
		return
	}
	if (!verifyBitcoinMessage(message, signature, rootKey)) {
		throw new Error(`That isn't a signature of this list by the root key ${rootKey}`)
	}

	const text = formatSigningKeysList({
		date,
		requiredSignatures,
		keys,
		revokedReleases,
		rootSignatures: [signature],
		handovers,
	})
	verifySigningKeysList(text)
	const archived = path.join(KEYS_ARCHIVE_DIRECTORY, archivedSigningKeysListName(date))
	await fs.mkdir(KEYS_ARCHIVE_DIRECTORY, {recursive: true})
	for (const file of [BUNDLED_SIGNING_KEYS_PATH, PUBLISHED_SIGNING_KEYS_PATH, archived]) await fs.writeFile(file, text)
	console.log(
		`\nSigned ${path.relative(process.cwd(), BUNDLED_SIGNING_KEYS_PATH)}, copied it to ${path.relative(process.cwd(), PUBLISHED_SIGNING_KEYS_PATH)} and archived it to ${path.relative(process.cwd(), archived)}.`,
	)
	console.log("Commit them, and once they're merged publish the list so devices pick it up within a day:")
	console.log(`  ${SIGNING_KEYS_URLS[0]}`)
	console.log(`  ${SIGNING_KEYS_URLS[1]}, by publishing the repo`)
}

// A release's directory, from a URL or path for it or one of its files, like
// https://download.umbrel.com/release/2.1.0/ or ./release/manifest.txt.sig
function releaseDirectory(source: string) {
	if (isUrl(source)) {
		checkUrl(source)
		return releaseDirectoryUrl(source)
	}
	return [MANIFEST_FILE, RELEASE_NOTES_FILE, ...SIGNATURE_FILES].includes(path.basename(source))
		? path.dirname(source)
		: source
}

const releaseFile = (directory: string, file: string) =>
	isUrl(directory) ? releaseFileUrl(directory, file) : path.join(directory, file)

// Where sign or root-sign saves a signature file: next to a release in a local directory, or in the
// current directory for a release on the download server, to upload from there by hand
const signaturePathFor = (directory: string, file: SignatureFile) =>
	isUrl(directory) ? path.resolve(file) : releaseFile(directory, file)

// A release's signature files, for its manifest and its release notes, which are signed separately
const SIGNATURE_FILES = [MANIFEST_SIGNATURE_FILE, RELEASE_NOTES_SIGNATURE_FILE] as const
type SignatureFile = (typeof SIGNATURE_FILES)[number]

type ReleaseFiles = {
	manifest: string
	releaseNotes?: string
	signatureFiles: Partial<Record<SignatureFile, string>>
}

// A release's manifest, and its release notes and signature files if it has them, or given release notes
// in place of its own
export async function readRelease(
	directory: string,
	{releaseNotes}: {releaseNotes?: string} = {},
): Promise<ReleaseFiles> {
	const [manifest, notes, ...signatureFiles] = await Promise.all([
		read(releaseFile(directory, MANIFEST_FILE)),
		releaseNotes ? read(releaseNotes) : readIfExists(releaseFile(directory, RELEASE_NOTES_FILE)),
		...SIGNATURE_FILES.map((file) => readIfExists(releaseFile(directory, file))),
	])
	return {
		manifest,
		releaseNotes: notes,
		signatureFiles: Object.fromEntries(SIGNATURE_FILES.map((file, index) => [file, signatureFiles[index]])),
	}
}

// The message each of a release's signature files signs: its manifest, and its release notes with its
// version, if it has release notes
function signedMessages({manifest, releaseNotes}: Pick<ReleaseFiles, 'manifest' | 'releaseNotes'>) {
	const {version} = parseReleaseManifest(manifest)
	const messages: Partial<Record<SignatureFile, string>> = {[MANIFEST_SIGNATURE_FILE]: formatManifestMessage(manifest)}
	if (releaseNotes !== undefined) {
		messages[RELEASE_NOTES_SIGNATURE_FILE] = formatReleaseNotesMessage(version, releaseNotes)
	}
	return messages
}

// The approved keys lists a release's signature files carry
const carriedSigningKeys = ({signatureFiles}: ReleaseFiles) =>
	Object.values(signatureFiles).map((text) => (text ? readSignatureFile(text).signingKeys : undefined))

// Verify a release like a device does, against the newest of the lists its signature files carry and the
// published ones
async function verifySignedRelease(files: ReleaseFiles) {
	const {manifest, releaseNotes, signatureFiles} = files
	if (!signatureFiles[MANIFEST_SIGNATURE_FILE]) throw new Error("This release isn't signed")
	const manifestSignatures = readSignatureFile(signatureFiles[MANIFEST_SIGNATURE_FILE])
	const notesSignatureFile = signatureFiles[RELEASE_NOTES_SIGNATURE_FILE]
	const releaseNotesSignatures = notesSignatureFile ? readSignatureFile(notesSignatureFile) : undefined
	const signingKeys = await findSigningKeys(carriedSigningKeys(files))
	return {
		...(await verifyRelease({manifest, manifestSignatures, releaseNotes, releaseNotesSignatures, signingKeys})),
		signingKeys,
	}
}

// A signature file with a signer's new signature, replacing any they made before, and the newest approved
// keys list
export function addReleaseSignature({
	signingKeysList,
	signatures,
	rootSignatures,
	signature,
}: {
	signingKeysList: string
	signatures: ReleaseSignature[]
	rootSignatures?: string[]
	signature: ReleaseSignature
}) {
	return formatSignatureFile({
		signingKeysList,
		signatures: [...signatures.filter((existing) => existing.name !== signature.name), signature],
		rootSignatures,
	})
}

// The signatures of a message the list still accepts. Signing a release again after its key is revoked,
// or its release notes change, drops the signatures that no longer count, and says so.
export function keepValidSignatures({
	message,
	signatures,
	rootSignatures,
	signingKeys,
}: {
	message: string
	signatures: ReleaseSignature[]
	rootSignatures: string[]
	signingKeys: Pick<SigningKeysList, 'keys' | 'rootKey'>
}) {
	const kept: ReleaseSignature[] = []
	for (const signature of signatures) {
		const key = signingKeys.keys.find((key) => key.name === signature.name)
		if (key && verifySignerSignature(message, signature.signature, key.publicKey)) kept.push(signature)
		else console.warn(`Dropping the signature under the name ${signature.name}, which doesn't count any more`)
	}
	const keptRoot = rootSignatures.filter((signature) => verifyBitcoinMessage(message, signature, signingKeys.rootKey))
	if (keptRoot.length < rootSignatures.length) console.warn("Dropping a root key signature that doesn't count any more")
	return {signatures: kept, rootSignatures: keptRoot}
}

// What to sign for a release: its manifest and its release notes, or given release notes, only those, so
// fixing them never signs what devices install again. Each with the signatures of it that still count,
// and the newest approved keys list.
async function prepareSigning(directory: string, {releaseNotes}: SignOptions) {
	const files = await readRelease(directory, {releaseNotes})
	// Devices don't download more than this of either, so they'd never see a release that's signed with more
	for (const [file, text] of [
		[MANIFEST_FILE, files.manifest],
		[RELEASE_NOTES_FILE, files.releaseNotes ?? ''],
	]) {
		if (Buffer.byteLength(text) > DOWNLOAD_SIZE_LIMIT) {
			throw new Error(`${file} is over the ${DOWNLOAD_SIZE_LIMIT} bytes devices download`)
		}
	}
	// Signatures cover the manifest's text without whitespace at its ends, but devices only accept a
	// manifest that's exactly that text and the newline it ends with, so signing any other file would sign
	// a release devices refuse to install
	if (files.manifest !== `${formatManifestMessage(files.manifest)}\n`) {
		throw new Error(`${releaseFile(directory, MANIFEST_FILE)} isn't a release manifest devices would accept`)
	}
	const release = parseReleaseManifest(files.manifest)
	const messages = signedMessages(files)
	if (messages[RELEASE_NOTES_SIGNATURE_FILE] === undefined) {
		console.warn(`The release has no ${RELEASE_NOTES_FILE}, so only its manifest is signed.`)
	}
	const signingKeys = await findSigningKeys(carriedSigningKeys(files))
	const parts = []
	const signing: readonly SignatureFile[] = releaseNotes ? [RELEASE_NOTES_SIGNATURE_FILE] : SIGNATURE_FILES
	for (const file of signing) {
		const message = messages[file]
		if (message === undefined) continue
		const existing = files.signatureFiles[file] ? readSignatureFile(files.signatureFiles[file]) : undefined
		const kept = keepValidSignatures({
			message,
			signatures: existing?.signatures ?? [],
			rootSignatures: existing?.rootSignatures ?? [],
			signingKeys,
		})
		parts.push({file, message, ...kept})
	}
	return {release, signingKeys, parts}
}

// Text as it's safe to show a signer reviewing it in a terminal: any character other than visible ones,
// spaces, tabs and newlines is shown as an escape like \u{200b}, so control sequences, direction overrides
// and zero-width characters can't hide or rewrite what they're signing
export const showHidden = (text: string) =>
	text.replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S} \t\n]/gu, (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`)

// Show exactly what's being signed
function printRelease({release, parts}: Awaited<ReturnType<typeof prepareSigning>>) {
	for (const {file, message, signatures} of parts) {
		console.log(`${file} signs:\n${showHidden(message)}\n`)
		if (signatures.length > 0) {
			console.log(`It's signed by ${signatures.map((signature) => signature.name).join(' and ')} so far.\n`)
		}
	}
	console.log(
		`This is ${showHidden(release.name)} (${release.version}) with ${Object.keys(release.files).length} files.`,
	)
}

type SignOptions = {releaseNotes?: string}

// The code that confirms exactly what sign showed: the SHA-256 of each signature file's name and message
export const confirmationCode = (parts: {file: string; message: string}[]) =>
	sha256(JSON.stringify(parts.map(({file, message}) => [file, message])))

// The command again, with its options, like the release notes to sign
// An argument as it can be pasted into a shell
export const shellQuote = (argument: string) =>
	/^[A-Za-z0-9_./:@%+=,-]+$/.test(argument) ? argument : `'${argument.replace(/'/g, "'\\''")}'`

// The command again, with its options, like the release notes to sign
const signCommand = (command: string, source: string, {releaseNotes}: SignOptions) =>
	[command, shellQuote(source), ...(releaseNotes ? ['--release-notes', shellQuote(releaseNotes)] : [])].join(' ')

// Sign a release with this Mac's signing key. Without confirm it shows exactly what it would sign and the
// code that confirms it. With the code it signs only if that's still what it would sign, like if the
// release on the download server hasn't changed since, and Touch ID's dialog, which macOS shows, names the
// release and the signing key, so the signer can check them there too.
async function sign(source: string, {confirm, ...options}: SignOptions & {confirm?: string} = {}) {
	const keyPath = SIGNING_KEY_PATH
	const directory = releaseDirectory(source)
	const prepared = await prepareSigning(directory, options)
	const {release, signingKeys, parts} = prepared
	const code = confirmationCode(parts)

	const publicKey = await signingPublicKey(keyPath)
	if (!publicKey) {
		throw new Error(
			`There's no signing key at ${keyPath}. Create one with ${tool('provision <name>')} and ask the root key holder to approve it with ${tool('sign-keys-list')}.`,
		)
	}
	const signer = signingKeys.keys.find((key) => key.publicKey === publicKey)
	if (!signer) {
		const {description, advice} = await keyStatus(publicKey)
		throw new Error(
			`This Mac's signing key, ${publicKey}, can't sign releases yet: it's ${description}.${advice ? `\n${advice}` : ''}`,
		)
	}

	if (confirm !== code) {
		if (confirm !== undefined) {
			throw new Error(
				`What it would sign has changed since it was shown, or that isn't the code it showed. See it again with:\n  ${tool(signCommand('sign', source, options))}`,
			)
		}
		printRelease(prepared)
		console.log(`\nConfirmation code: ${code}`)
		console.log(`To sign exactly this as ${signer.name}, with Touch ID:`)
		console.log(`  ${tool(`${signCommand('sign', source, options)} --confirm ${code}`)}`)
		return
	}

	// One Touch ID for every file. Its dialog follows macOS's "umbrelOS Release Signing is trying to".
	const what = parts.map(({file}) => (file === MANIFEST_SIGNATURE_FILE ? 'manifest' : 'release notes')).join(' and ')
	const reason = `sign umbrelOS ${release.version} ${what} as ${signer.name}`
	console.log(`\nTouch ID to sign ${what}`)
	const output = await secureEnclaveKey('sign', keyPath, {
		input: JSON.stringify(parts.map(({message}) => message)),
		reason,
	}).catch((error) => {
		// Only the Secure Enclave failing to load or use the key, like after Touch ID's fingers changed, means it
		// needs replacing. Touch ID failing, like cancelled, locked out or unavailable, doesn't.
		const keyFailed = /^The Secure Enclave/.test(error.message)
		throw new Error(
			`Couldn't sign: ${error.message}${keyFailed ? `\nIf Touch ID's fingers changed since this key was made, it can't sign any more. ${replaceKeySteps}` : '. Sign again.'}`,
		)
	})
	const signed = JSON.parse(output) as string[]
	if (!Array.isArray(signed) || signed.length !== parts.length)
		throw new Error("The Secure Enclave helper didn't sign every file")

	for (const [index, {file, message, signatures, rootSignatures}] of parts.entries()) {
		const signature = signed[index]
		// Check the new signature verifies before handing it out
		if (!verifySignerSignature(message, signature, signer.publicKey)) {
			throw new Error(`The Secure Enclave's signature of ${file.replace(/\.sig$/, '')} doesn't verify`)
		}
		const signatureFilePath = signaturePathFor(directory, file)
		await fs.writeFile(
			signatureFilePath,
			addReleaseSignature({
				signingKeysList: signingKeys.text,
				signatures,
				rootSignatures,
				signature: {name: signer.name, signature},
			}),
		)
		console.log(`Signed ${file.replace(/\.sig$/, '')} as ${signer.name}, saved to ${signatureFilePath}`)

		const signers = signatures.filter((other) => other.name !== signer.name).length + 1
		if (rootSignatures.length === 0 && signers < signingKeys.requiredSignatures) {
			const needed = signingKeys.requiredSignatures - signers
			console.log(
				`Releases need ${signingKeys.requiredSignatures} signers, so ${needed} more ${needed === 1 ? 'has' : 'have'} to sign it, once it's uploaded, before devices accept it.`,
			)
		}
	}
	printUploadStep(directory, options.releaseNotes)
}

// Sign a release with the root key alone, for when signers can't, like if their keys are lost or
// compromised or not enough of them are available. Without the root key's signatures it shows the messages
// to sign.
async function rootSign(
	source: string,
	{
		signature: manifestSignature,
		releaseNotesSignature,
		...options
	}: SignOptions & {signature?: string; releaseNotesSignature?: string} = {},
) {
	const directory = releaseDirectory(source)
	const prepared = await prepareSigning(directory, options)
	const {signingKeys, parts} = prepared
	const signatureOf = (file: SignatureFile) =>
		file === MANIFEST_SIGNATURE_FILE ? manifestSignature : releaseNotesSignature

	if (parts.some(({file}) => !signatureOf(file))) {
		printRelease(prepared)
		for (const {file, message} of parts) {
			console.log(`\nFor ${file}:`)
			printRootSigningSteps(signingKeys.rootKey, message)
		}
		const flags = parts.map(({file}) =>
			file === MANIFEST_SIGNATURE_FILE ? '--signature <signature>' : '--release-notes-signature <signature>',
		)
		console.log('Then save the signatures with:')
		console.log(`  ${tool(`${signCommand('root-sign', source, options)} ${flags.join(' ')}`)}`)
		return
	}

	for (const {file, message, signatures} of parts) {
		const signature = signatureOf(file)!
		if (!verifyBitcoinMessage(message, signature, signingKeys.rootKey)) {
			throw new Error(`That isn't the root key ${signingKeys.rootKey}'s signature of ${file.replace(/\.sig$/, '')}`)
		}

		const signatureFilePath = signaturePathFor(directory, file)
		await fs.writeFile(
			signatureFilePath,
			formatSignatureFile({signingKeysList: signingKeys.text, signatures, rootSignatures: [signature]}),
		)
		console.log(`\nSigned by the root key, saved to ${signatureFilePath}`)
	}
	printUploadStep(directory, options.releaseNotes)
}

// How to publish the signature files sign or root-sign saved, which is done by hand
function printUploadStep(directory: string, releaseNotes?: string) {
	if (!isUrl(directory)) return
	console.log(
		`\nUpload them to ${directory}${releaseNotes ? `, with ${releaseNotes} as ${RELEASE_NOTES_FILE}` : ''}, then check it with:`,
	)
	console.log(`  ./scripts/release-signing verify ${directory}`)
}

async function verify(source: string, {releaseNotes, files}: {releaseNotes?: string; files?: string}) {
	const directory = releaseDirectory(source)
	const release = await verifySignedRelease(await readRelease(directory, {releaseNotes}))
	if (release.signedByRootKey) {
		console.log(`${release.name} (${release.version}) is signed by the root key ${release.signingKeys.rootKey}`)
	} else {
		console.log(
			`${release.name} (${release.version}) is signed by ${release.signers.map((signer) => `${signer.name} (${signer.publicKey})`).join(' and ')},`,
		)
		console.log(
			`approved by the list from ${release.signingKeys.date.toISOString()}, which needs ${release.signingKeys.requiredSignatures}`,
		)
	}
	console.log(
		release.releaseNotesError
			? `Devices don't show its release notes: ${release.releaseNotesError.message}`
			: 'Its release notes are signed',
	)
	if (!files) return

	let checked = 0
	let mismatched = false
	for (const [file, {sha256: expectedSha256}] of Object.entries(release.files)) {
		const data = await fs.readFile(path.join(files, file)).catch(() => undefined)
		if (!data) {
			console.log(`MISSING   ${file}`)
			continue
		}
		const matches = sha256(data) === expectedSha256
		console.log(`${matches ? 'OK      ' : 'MISMATCH'}  ${file}`)
		checked++
		mismatched ||= !matches
	}
	if (mismatched) throw new Error("Some files don't match the signed release")
	if (checked === 0) throw new Error(`None of the release's files are in ${files}`)
}

// Run as a script, rather than imported by tests
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
	const parsed = (() => {
		try {
			return parseArgs({
				allowPositionals: true,
				options: {
					'release-notes': {type: 'string'},
					files: {type: 'string'},
					confirm: {type: 'string'},
					signature: {type: 'string'},
					'release-notes-signature': {type: 'string'},
					date: {type: 'string'},
				},
			})
		} catch (error) {
			// Like an option this doesn't have
			console.error(`Error: ${(error as Error).message.split('.')[0]}\n${usage}`)
			process.exit(1)
		}
	})()
	const {positionals, values} = parsed
	const [command, ...commandArguments] = positionals
	const options = {
		...values,
		releaseNotes: values['release-notes'],
		releaseNotesSignature: values['release-notes-signature'],
	}

	try {
		if (command === 'list-keys' && commandArguments.length === 0) {
			await listKeys()
		} else if (command === 'provision' && commandArguments.length === 1) {
			await provision(commandArguments[0])
		} else if (command === 'delete-key' && commandArguments.length === 0) {
			await deleteKey(options)
		} else if (command === 'revoke' && commandArguments.length === 1) {
			await revoke(commandArguments[0])
		} else if (command === 'require-signatures' && commandArguments.length === 1) {
			await requireSignatures(commandArguments[0])
		} else if (command === 'revoke-release' && commandArguments.length === 1) {
			await revokeRelease(commandArguments[0])
		} else if (command === 'sign-keys-list' && commandArguments.length === 0) {
			await signKeysList(options)
		} else if (command === 'hand-over-root' && commandArguments.length === 1) {
			await handOverRoot(commandArguments[0], options)
		} else if (command === 'root-sign' && commandArguments.length === 1) {
			await rootSign(commandArguments[0], options)
		} else if (command === 'sign' && commandArguments.length === 1) {
			await sign(commandArguments[0], options)
		} else if (command === 'verify' && commandArguments.length === 1) {
			await verify(commandArguments[0], options)
		} else {
			console.error(usage)
			process.exitCode = 1
		}
	} catch (error) {
		console.error(`Error: ${(error as Error).message}`)
		process.exitCode = 1
	}
}
