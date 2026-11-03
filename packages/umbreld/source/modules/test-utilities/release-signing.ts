import crypto from 'node:crypto'
import https from 'node:https'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {$} from 'execa'
import fse from 'fs-extra'
import pWaitFor from 'p-wait-for'

import {
	parseReleaseManifest,
	type ReleaseFile,
	type RevokedRelease,
	type SigningKey,
} from '../update/release-signing.ts'
import type {createTestVm} from './create-test-umbreld.ts'

type TestVm = Awaited<ReturnType<typeof createTestVm>>

// A root key standing in for the hardware wallet
export function createRootKey() {
	const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'secp256k1'})
	const {x, y} = publicKey.export({format: 'jwk'})
	const yBytes = Buffer.from(y!, 'base64url')
	const compressed = Buffer.concat([Buffer.from([yBytes[31] & 1 ? 3 : 2]), Buffer.from(x!, 'base64url')])
	return {privateKey, publicKey: compressed.toString('hex')}
}

export type RootKey = ReturnType<typeof createRootKey>

// Sign a Bitcoin message like a hardware wallet does. The header byte is only used for key recovery, which
// verification against a known key skips, so any valid one will do.
export function signBitcoinMessage(message: string, privateKey: crypto.KeyObject) {
	const messageBytes = Buffer.from(message, 'utf8')
	const length =
		messageBytes.length < 0xfd
			? Buffer.from([messageBytes.length])
			: Buffer.from([0xfd, messageBytes.length & 0xff, messageBytes.length >> 8])
	const prefix = Buffer.from('\x18Bitcoin Signed Message:\n', 'latin1')
	const hash = crypto
		.createHash('sha256')
		.update(Buffer.concat([prefix, length, messageBytes]))
		.digest()
	const signature = crypto.sign('sha256', hash, {key: privateKey, dsaEncoding: 'ieee-p1363'})
	return Buffer.concat([Buffer.from([31]), signature]).toString('base64')
}

// An approved signing keys list in schema 1, written out here rather than with umbreld's own formatting so
// tests notice if that changes
// A root key handover, which `from` signs to hand the root key over to `to`
export function createRootKeyHandover({date, from, to}: {date: string; from: RootKey; to: RootKey}) {
	const message = [
		'--- umbrelOS Root Key Handover ---',
		'Schema: 1',
		`Date: ${date}`,
		`From: ${from.publicKey}`,
		`To: ${to.publicKey}`,
	].join('\n')
	return `${message}\nRoot-Signature: ${signBitcoinMessage(message, from.privateKey)}\n`
}

// An approved signing keys list in schema 1 signed by rootKey, ending with the handovers from the first
// root key to it. It's written out here rather than with umbreld's own formatting so tests notice if
// that changes.
export function createSigningKeysList({
	date,
	requiredSignatures = 1,
	keys,
	revokedReleases = [],
	rootKey,
	handovers = [],
}: {
	date: string
	requiredSignatures?: number
	keys: SigningKey[]
	revokedReleases?: RevokedRelease[]
	rootKey: RootKey
	handovers?: string[]
}) {
	const message = [
		'--- umbrelOS Signing Keys ---',
		'Schema: 1',
		`Date: ${date}`,
		`Required-Signatures: ${requiredSignatures}`,
		...keys.map((key) => `Key: ${key.name} ${key.publicKey}`),
		...revokedReleases.map(({manifest, label}) => `Revoked-Release: sha256:${manifest}${label ? ` ${label}` : ''}`),
	].join('\n')
	const list = `${message}\nRoot-Signature: ${signBitcoinMessage(message, rootKey.privateKey)}\n`
	return [list, ...handovers].join('\n')
}

// The message signers sign for a release's notes, in schema 1, written out here rather than with umbreld's
// own formatting so tests notice if that changes. The message for its manifest is the manifest.
export const createReleaseNotesMessage = (version: string, releaseNotes: string) =>
	`--- umbrelOS Release Notes ---\nSchema: 1\nVersion: ${version}\n\n${releaseNotes}`.trim()

// The root key's signature of a message, which it can sign by itself, as its line in a signature file
export const rootSignatureLine = (message: string, rootKey: RootKey) =>
	`Root-Signature: ${signBitcoinMessage(message, rootKey.privateKey)}`

// A signer's signature as its line in a signature file, under the name given
export const signatureLine = (name: string, signature: string) => `Signature: ${name} ${signature}`

// A release signer's key. Real signers' keys are P-256 keys in their Mac's Secure Enclave, which sign the
// same way.
export function createSigningKey(name: string) {
	const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'})
	const {x, y} = publicKey.export({format: 'jwk'})
	const yBytes = Buffer.from(y!, 'base64url')
	const compressed = Buffer.concat([Buffer.from([yBytes[31] & 1 ? 3 : 2]), Buffer.from(x!, 'base64url')])
	return {name, privateKey, publicKey: compressed.toString('hex')}
}

export type SignerKey = ReturnType<typeof createSigningKey>

export const signingKey = (key: SignerKey): SigningKey => ({name: key.name, publicKey: key.publicKey})

// What signers' keys sign before each message, written out here rather than taken from umbreld so tests
// notice if it changes
export const SIGNER_MESSAGE_PREFIX = 'umbrelOS release signature\n'

// A signer's signature of a message, like the Secure Enclave helper makes: ECDSA P-256 with SHA-256 of the
// message after the prefix, as r and s in base64
export const signerSign = (message: string, key: SignerKey, prefix = SIGNER_MESSAGE_PREFIX) =>
	crypto
		.sign('sha256', Buffer.from(`${prefix}${message}`, 'utf8'), {key: key.privateKey, dsaEncoding: 'ieee-p1363'})
		.toString('base64')

type SignOptions = {
	signingKeysList: string
	signers: SignerKey[]
	rootKey?: RootKey
	prefix?: string
}

// A signature file of a message: the root key's signature if it signs, each signer's signature, then the
// approved signing keys list its signers were approved by
export async function signMessage(message: string, {signingKeysList, signers, rootKey, prefix}: SignOptions) {
	const signatures = signers.map((signer) => signatureLine(signer.name, signerSign(message, signer, prefix)))
	const block = [
		'--- umbrelOS Signatures ---',
		...(rootKey ? [rootSignatureLine(message, rootKey)] : []),
		...signatures,
	]
	return `${block.join('\n')}\n\n${signingKeysList}`
}

// A release's signature files: manifest.txt.sig, of its manifest, and release-notes.md.sig, of its release
// notes with its version
export async function signRelease(
	manifest: string,
	{releaseNotes = '', ...options}: SignOptions & {releaseNotes?: string},
) {
	const {version} = parseReleaseManifest(manifest)
	const [manifestSignature, releaseNotesSignature] = await Promise.all([
		signMessage(manifest.trim(), options),
		signMessage(createReleaseNotesMessage(version, releaseNotes), options),
	])
	return {manifestSignature, releaseNotesSignature}
}

// A release manifest in schema 1, by default for a release with one amd64 update bundle
export function createManifest(
	version: string,
	{
		name = `umbrelOS ${version}`,
		date = '2026-11-04T12:00:00Z',
		files = {
			'umbrelos-amd64.img.xz': {sha256: 'cd'.repeat(32)},
			'umbrelos-amd64.update': {
				sha256: 'ef'.repeat(32),
				bundle: `sha512-256:${'ab'.repeat(32)}`,
				bootFlow: 'grub',
				arch: 'amd64',
			},
		},
		dockerImage,
	}: {
		name?: string
		date?: string
		dockerImage?: string
		files?: Record<string, ReleaseFile>
	} = {},
) {
	const fileLines = Object.entries(files).map(([file, {sha256, bundle, bootFlow, arch, type}]) =>
		[
			`File: ${file} sha256:${sha256}`,
			...(bundle ? [`bundle:${bundle}`] : []),
			...(bootFlow ? [`boot-flow:${bootFlow}`] : []),
			...(arch ? [`arch:${arch}`] : []),
			...(type ? [`type:${type}`] : []),
		].join(' '),
	)
	const lines = [
		'--- umbrelOS Manifest ---',
		'Schema: 1',
		`Version: ${version}`,
		`Name: ${name}`,
		`Date: ${date}`,
		...(dockerImage ? [`Docker-Image: ${dockerImage}`] : []),
		...fileLines,
	]
	return `${lines.join('\n')}\n`
}

// A signature by a real Secure Enclave key, made with scripts/secure-enclave-key.swift from a key without
// Touch ID, since signing with a signer's needs it
export const secureEnclaveSignatureVector = {
	message: 'This is a test, this is only a test',
	signature: 'ydP8pqRnnm3LK7KPtgVDidXahM4ma9k6K7ZhVUan17ZwOLjtkqNMOqGv2uq+a/3BN2aZrxAtqR71Zk16hFf16w==',
	publicKey: '036bfd641194e6cdc3a620997d3af79fdcf692a22d6dbb2f4f9a40606543306df6',
}

// The address VMs reach the test host at
export const testHostAddress = '10.0.2.2'

// Where VM tests put the files they swap into the system. /run is a tmpfs, so they're gone after a reboot.
const vmTestDirectory = '/run/umbrel-release-signing-test'

type ApiResponse = string | {status: number; body?: string} | undefined

// Stand-ins for api.umbrel.com and the GitHub mirror of the approved keys list, served over HTTPS
// with a certificate VMs are made to trust by redirectToUmbrelApi()
export async function serveUmbrelApi() {
	const directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-test-api-'))
	await fse.writeFile(
		`${directory}/server.ext`,
		[
			'subjectAltName=DNS:api.umbrel.com,DNS:raw.githubusercontent.com',
			'extendedKeyUsage=serverAuth',
			'basicConstraints=CA:FALSE',
		].join('\n'),
	)
	await $({
		cwd: directory,
	})`openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=umbrelOS-test-CA -keyout ca.key -out ca.crt`
	await $({
		cwd: directory,
	})`openssl req -newkey rsa:2048 -nodes -subj /CN=api.umbrel.com -keyout server.key -out server.csr`
	await $({
		cwd: directory,
	})`openssl x509 -req -days 1 -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -extfile server.ext -out server.crt`
	const [caCertificate, key, cert] = await Promise.all(
		['ca.crt', 'server.key', 'server.crt'].map((file) => fse.readFile(`${directory}/${file}`, 'utf8')),
	)
	await fse.remove(directory)

	// Responses by URL without the query string. Anything else is a 404.
	const responses = new Map<string, ApiResponse>()
	const requests: {url: string; userAgent?: string}[] = []
	const server = https.createServer({key, cert}, (request, response) => {
		const url = new URL(request.url ?? '/', `https://${request.headers.host}`)
		requests.push({url: url.href, userAgent: request.headers['user-agent']})
		const result = responses.get(`${url.origin}${url.pathname}`)
		const {status, body} = typeof result === 'string' ? {status: 200, body: result} : (result ?? {status: 404})
		response.writeHead(status)
		response.end(body)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

	return {
		port: (server.address() as AddressInfo).port,
		caCertificate,
		requests,
		respond(url: string, response: ApiResponse) {
			responses.set(url, response)
		},
		async close() {
			server.closeAllConnections()
			await new Promise((resolve) => server.close(resolve))
		},
	}
}

export type UmbrelApi = Awaited<ReturnType<typeof serveUmbrelApi>>

async function writeVmFile(umbreld: TestVm, file: string, content: string) {
	await umbreld.vm.sshAsRoot(
		`mkdir -p '${path.dirname(file)}' && printf '%s' '${Buffer.from(content).toString('base64')}' | base64 -d > '${file}'`,
	)
}

export type ArchivedReleaseResult =
	| {version: string; name: string; signedByRootKey: boolean; signers: string[]}
	| {version: string; error: string}

// Verify each archived release in a directory, like releases/, and its release notes, with the device's own
// release verification: its Node and OpenSSL and the root key built into it. Each is
// verified against the keys list its manifest's signatures carry, like the CI check of releases/, so a key
// revoked since doesn't fail an older release.
export async function verifyArchivedReleasesOnDevice(umbreld: TestVm, directory: string) {
	const deviceDirectory = `${vmTestDirectory}/archived-releases`
	await umbreld.vm.sshAsRoot(`rm -rf ${deviceDirectory} && mkdir -p ${deviceDirectory}`)
	const files = (await fse.readdir(directory)).filter((file) =>
		/-(manifest\.txt|release-notes\.md)(\.sig)?$/.test(file),
	)
	for (const file of files) {
		await writeVmFile(umbreld, `${deviceDirectory}/${file}`, await fse.readFile(path.join(directory, file), 'utf8'))
	}

	const script = `
		import fs from 'node:fs'
		import {readSignatureFile, verifyRelease} from '/opt/umbreld/source/modules/update/release-signing.ts'
		const directory = process.argv[1]
		const read = (file) => fs.readFileSync(directory + '/' + file, 'utf8')
		const results = []
		for (const file of fs.readdirSync(directory).filter((file) => file.endsWith('-manifest.txt')).sort()) {
			const version = file.slice(0, -'-manifest.txt'.length)
			try {
				const manifestSignatures = readSignatureFile(read(file + '.sig'))
				const releaseNotesSignatures = readSignatureFile(read(version + '-release-notes.md.sig'))
				if (!manifestSignatures.signingKeys) throw manifestSignatures.signingKeysError
				const release = await verifyRelease({
					manifest: read(file),
					manifestSignatures,
					releaseNotes: read(version + '-release-notes.md'),
					releaseNotesSignatures,
					signingKeys: manifestSignatures.signingKeys,
				})
				if (release.releaseNotesError) throw release.releaseNotesError
				results.push({
					version,
					name: release.name,
					signedByRootKey: release.signedByRootKey,
					signers: release.signers.map((signer) => signer.name),
				})
			} catch (error) {
				results.push({version, error: error.message})
			}
		}
		console.log(JSON.stringify(results))
	`
	const output = await umbreld.vm.sshAsRoot(
		`cd /opt/umbreld && node --input-type=module --eval "$(printf %s '${Buffer.from(script).toString('base64')}' | base64 -d)" '${deviceDirectory}'`,
	)
	return JSON.parse(output.trim().split('\n').at(-1)!) as ArchivedReleaseResult[]
}

export async function restartUmbreld(umbreld: TestVm) {
	await umbreld.vm.sshAsRoot('systemctl restart umbrel')
	await umbreld.waitForStartup({waitForUser: true})
}

// Send the VM's requests to api.umbrel.com and raw.githubusercontent.com to the stand-in API, and trust
// its certificate, then restart umbreld so it picks them up. Lasts until the VM reboots.
export async function redirectToUmbrelApi(umbreld: TestVm, api: UmbrelApi) {
	await writeVmFile(umbreld, `${vmTestDirectory}/test-ca.crt`, api.caCertificate)
	await umbreld.vm.sshAsRoot(
		[
			`cp /etc/hosts ${vmTestDirectory}/hosts`,
			`echo '${testHostAddress} api.umbrel.com raw.githubusercontent.com' >> ${vmTestDirectory}/hosts`,
			`mount --bind ${vmTestDirectory}/hosts /etc/hosts`,
			// Node's OpenSSL looks CAs up by hash in the certificates directory rather than in the bundle
			`cp -a /etc/ssl/certs ${vmTestDirectory}/certs`,
			`cp ${vmTestDirectory}/test-ca.crt ${vmTestDirectory}/certs/umbrel-release-signing-test.pem`,
			`cat ${vmTestDirectory}/test-ca.crt >> ${vmTestDirectory}/certs/ca-certificates.crt`,
			`openssl rehash ${vmTestDirectory}/certs`,
			`mount --bind ${vmTestDirectory}/certs /etc/ssl/certs`,
			// HTTPS requests go to port 443, which the test host can't listen on without root
			'nft add table ip umbrel_release_signing_test',
			"nft add chain ip umbrel_release_signing_test output '{ type nat hook output priority -100; }'",
			`nft add rule ip umbrel_release_signing_test output ip daddr ${testHostAddress} tcp dport 443 dnat to ${testHostAddress}:${api.port}`,
		].join(' && '),
	)
	await restartUmbreld(umbreld)
}

// umbreld only trusts the root key built into it, so swap in a test root and an approved keys list it
// signed, like a build with that root would have, then restart umbreld. Lasts until the VM reboots. It
// finds the root key by its definition, so it works on older releases built with another root key.
export async function trustRootKey(umbreld: TestVm, rootKey: RootKey, bundledSigningKeys: string) {
	const definition = "ROOT_PUBLIC_KEY = '[0-9a-f]\\{66\\}'"
	const sources = (
		await umbreld.vm.sshAsRoot(
			`grep --recursive --files-with-matches --exclude-dir=node_modules "${definition}" /opt/umbreld || true`,
		)
	)
		.split('\n')
		.filter(Boolean)
	if (sources.length === 0) throw new Error('Expected the root key definition in /opt/umbreld')
	const [bundledList, ...otherLists] = (
		await umbreld.vm.sshAsRoot(`find /opt/umbreld -name umbrelos-signing-keys.txt -not -path '*/node_modules/*'`)
	).split('\n')
	if (!bundledList || otherLists.length > 0) throw new Error(`Expected one bundled signing keys list in /opt/umbreld`)

	await writeVmFile(umbreld, `${vmTestDirectory}/umbrelos-signing-keys.txt`, bundledSigningKeys)
	await umbreld.vm.sshAsRoot(
		[
			...sources.flatMap((source, index) => [
				`sed "s/${definition}/ROOT_PUBLIC_KEY = '${rootKey.publicKey}'/" '${source}' > ${vmTestDirectory}/root-key-${index}`,
				`mount --bind ${vmTestDirectory}/root-key-${index} '${source}'`,
			]),
			`mount --bind ${vmTestDirectory}/umbrelos-signing-keys.txt '${bundledList}'`,
		].join(' && '),
	)
	await restartUmbreld(umbreld)
}

// umbreld's log lines from after the cursor a previous call returned, and the cursor to read on from.
// Without a cursor it only returns the cursor of the latest line.
export async function readUmbreldLogs(umbreld: TestVm, cursor?: string) {
	const output = await umbreld.vm.sshAsRoot(
		`journalctl --unit umbrel --output cat --no-pager --show-cursor ${cursor ? `--after-cursor '${cursor}'` : '--lines 1'}`,
	)
	const match = output.match(/^-- cursor: (.+)$/m)
	// journalctl prints no cursor when there's nothing new
	if (!match) return {logs: '', cursor}
	return {logs: cursor ? output.slice(0, match.index) : '', cursor: match[1]}
}

type ReleaseServer = {port: number; files: Map<string, string>; requestedPaths: string[]}

export const latestReleaseUrl = 'https://api.umbrel.com/latest-release'

// A bundle hash no bundle has, so a release pinning it gets as far as Rugix checking the bundle, which
// shows it passed verification, without installing anything
export const unmatchedBundleHash = `sha512-256:${'0'.repeat(64)}`

let releaseCount = 0

// The files the release job's create-release-manifest.sh pins for a release with these update bundles
// and their bundle hashes, so a test release gives each bundle the devices a real release does
export async function createReleaseManifestFiles(bundles: Record<string, string>) {
	const directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-release-manifest-'))
	try {
		for (const [bundle, bundleHash] of Object.entries(bundles)) {
			await fse.outputFile(`${directory}/release/${bundle}`, bundle)
			await fse.outputFile(`${directory}/build/${bundle}.hash`, `${bundleHash}\n`)
		}
		const script = fileURLToPath(new URL('../../../../os/create-release-manifest.sh', import.meta.url))
		await $({
			env: {BUILD_DIRECTORY: `${directory}/build`, RELEASE_NOTES_DIRECTORY: `${directory}/release-notes`},
		})`${script} ${directory}/release`
		return parseReleaseManifest(await fse.readFile(`${directory}/release/manifest.txt`, 'utf8')).files
	} finally {
		await fse.remove(directory)
	}
}

// The devices each update bundle is for, as create-release-manifest.sh pins them
const bundleDevices: Record<string, Pick<ReleaseFile, 'bootFlow' | 'arch'>> = {
	'umbrelos-amd64.update': {bootFlow: 'grub', arch: 'amd64'},
	'umbrelos-amd64-legacy.update': {bootFlow: 'mender-grub', arch: 'amd64'},
	'umbrelos-pi.update': {bootFlow: 'rpi-tryboot', arch: 'arm64'},
}

// Publish a release signed by the signers on the release server and point the update server at it. Its
// signature carries the approved keys list given.
export async function publishRelease(
	{api, releases}: {api: UmbrelApi; releases: ReleaseServer},
	{
		version = '99.0.0',
		signers,
		signingKeysList,
		rootKey,
		prefix,
		bundle = 'umbrelos-amd64.update',
		bundleHash = unmatchedBundleHash,
		releaseNotes = `Signed release notes for ${version}`,
		tamper = (manifest) => manifest,
		tamperReleaseNotes = (releaseNotes) => releaseNotes,
		unsigned = false,
		updateScript,
		servedUpdateScript = updateScript,
		files,
	}: {
		version?: string
		signers: SignerKey[]
		signingKeysList: string
		// Also signs it with this root key
		rootKey?: RootKey
		// What signers sign before the message, instead of what devices expect
		prefix?: string
		bundle?: string
		bundleHash?: string
		releaseNotes?: string
		// What the release server serves in place of the manifest and release notes
		tamper?: (manifest: string) => string
		tamperReleaseNotes?: (releaseNotes: string) => string
		unsigned?: boolean
		// An update script the manifest pins, and what the release server serves in its place, if not it
		updateScript?: string
		servedUpdateScript?: string
		// The files the manifest pins, instead of just the bundle
		files?: Record<string, ReleaseFile>
	},
) {
	const id = `release-${++releaseCount}`
	const name = `umbrelOS ${version} (${id})`
	const manifest = createManifest(version, {
		name,
		files: {
			...(files ?? {[bundle]: {sha256: '00'.repeat(32), bundle: bundleHash, ...bundleDevices[bundle]}}),
			...(updateScript !== undefined && {
				'update.sh': {
					sha256: crypto.createHash('sha256').update(updateScript).digest('hex'),
					type: 'update-script',
				},
			}),
		},
	})
	releases.files.set(`/${id}/manifest.txt`, tamper(manifest))
	releases.files.set(`/${id}/release-notes.md`, tamperReleaseNotes(releaseNotes))
	if (servedUpdateScript !== undefined) releases.files.set(`/${id}/update.sh`, servedUpdateScript)
	if (!unsigned) {
		const {manifestSignature, releaseNotesSignature} = await signRelease(manifest, {
			releaseNotes,
			signingKeysList,
			signers,
			rootKey,
			prefix,
		})
		releases.files.set(`/${id}/manifest.txt.sig`, manifestSignature)
		releases.files.set(`/${id}/release-notes.md.sig`, releaseNotesSignature)
	}
	api.respond(
		latestReleaseUrl,
		JSON.stringify({
			version,
			name: 'Unsigned name from the update server',
			releaseNotes: 'Unsigned release notes from the update server',
			releaseUrl: `http://${testHostAddress}:${releases.port}/${id}`,
		}),
	)

	return {
		id,
		version,
		manifest,
		signers,
		signedByRootKey: !!rootKey,
		name,
		releaseNotes,
		bundleRequested: () => releases.requestedPaths.includes(`/${id}/${bundle}`),
	}
}

export type PublishedRelease = Awaited<ReturnType<typeof publishRelease>>

// Install the latest release through umbreld's API, like the update button in Settings. That checks for
// the update first, and installs the release the check showed. A long install can outlast the HTTP
// client's wait for a response, and umbreld can stop to restart before it responds, so this also follows
// the update status.
export async function installLatestRelease(umbreld: TestVm) {
	// A release that doesn't verify fails the check, and then fails to install with the same error
	const checked = await umbreld.client.update.check.query().catch(() => undefined)
	let response: {success: boolean} | undefined
	umbreld.client.update.install.mutate({manifestHash: checked?.manifestHash}).then(
		(success) => (response = {success}),
		() => {},
	)
	let status: Awaited<ReturnType<typeof umbreld.client.update.status.query>> | undefined
	let sawRunning = false
	await pWaitFor(
		async () => {
			if (response) return true
			status = await umbreld.client.update.status.query().catch(() => undefined)
			sawRunning ||= !!status?.running
			// The install finished, or umbreld stopped to restart into the update
			return sawRunning && !status?.running
		},
		{interval: 1000, timeout: 1_800_000},
	)
	if (response) return {success: response.success, error: (await umbreld.client.update.status.query()).error}
	return {success: !status || status.description === 'Restarting...', error: status?.error ?? false}
}
