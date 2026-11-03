import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import {BUNDLED_SIGNING_KEYS_PATH, verifySigningKeysList} from './release-signing.ts'
import {ARCHIVE_DIRECTORY} from '../../../scripts/release-signing.ts'
import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {serveUpdateBundle} from '../test-utilities/os-update.ts'
import {
	createReleaseManifestFiles,
	createRootKey,
	createSigningKeysList,
	createSigningKey,
	installLatestRelease,
	publishRelease,
	readUmbreldLogs,
	redirectToUmbrelApi,
	secureEnclaveSignatureVector,
	serveUmbrelApi,
	signingKey,
	testHostAddress,
	trustRootKey,
	unmatchedBundleHash,
	verifyArchivedReleasesOnDevice,
	type SignerKey,
} from '../test-utilities/release-signing.ts'

// The Pi VM runs under TCG emulation and first boot runs the full Rugix bootstrap through the emulated SD
// card, see sd-card-only.pi.vm.test.ts
const startupTimeout = 2_700_000
// Restarting umbreld or verifying and starting an install is slow on the emulated Pi
const slowStepTimeout = 900_000

// Release verification on the Pi image, which has its own arm64 builds of Node and OpenSSH. See
// release-signing.vm.test.ts for the full set of checks on amd64.
describe('Release signing on a Raspberry Pi', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let api: Awaited<ReturnType<typeof serveUmbrelApi>>
	let releases: Awaited<ReturnType<typeof serveUpdateBundle>>
	let directory: string
	let alice: SignerKey
	let bob: SignerKey
	let mallory: SignerKey
	// The approved keys list releases carry with their signatures unless a test gives another
	let carriedList: string

	const publish = ({
		signer,
		signers = signer ? [signer] : [],
		signingKeysList = carriedList,
		...options
	}: Omit<Parameters<typeof publishRelease>[1], 'signers' | 'signingKeysList'> & {
		signer?: SignerKey
		signers?: SignerKey[]
		signingKeysList?: string
	}) => publishRelease({api, releases}, {bundle: 'umbrelos-pi.update', signers, signingKeysList, ...options})

	beforeAll(async () => {
		directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-release-signing-pi-vm-test-'))
		;[alice, bob, mallory] = await Promise.all(
			['alice-mbp-2026', 'bob-mbp-2025', 'mallory-mbp'].map((name) => createSigningKey(name)),
		)
		// The image's own list, signed by its root key
		carriedList = await fse.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8')
		api = await serveUmbrelApi()
		releases = await serveUpdateBundle()

		umbreld = await createTestVm({device: 'pi', startupTimeout})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		await redirectToUmbrelApi(umbreld, api)
		// Booting plus an umbreld restart
	}, startupTimeout + 600_000)

	afterAll(async () => {
		await umbreld?.cleanup()
		await releases?.close()
		await api?.close()
		await fse.remove(directory)
	})

	test(
		"verifies the image's approved keys list against its root key",
		async () => {
			// The number of signatures it needs comes from the image's own list
			const release = await publish({signer: mallory})
			const {requiredSignatures} = verifySigningKeysList(carriedList)
			await expect(installLatestRelease(umbreld)).resolves.toEqual({
				success: false,
				error: `This release has 0 of the ${requiredSignatures} signatures it needs from approved keys`,
			})
			expect(release.bundleRequested()).toBe(false)
		},
		slowStepTimeout,
	)

	test(
		"verifies a real Secure Enclave key's signatures with the image's Node",
		async () => {
			const {message, signature, publicKey} = secureEnclaveSignatureVector
			const signedMessage = message
			await umbreld.vm.sshAsRoot(
				`node -e 'const crypto = require("crypto"); const [publicKey, message, signature] = process.argv.slice(1); const key = crypto.createPublicKey({key: Buffer.concat([Buffer.from("3039301306072a8648ce3d020106082a8648ce3d030107032200", "hex"), Buffer.from(publicKey, "hex")]), format: "der", type: "spki"}); process.exit(crypto.verify("sha256", Buffer.from("umbrelOS release signature\\n" + message), {key, dsaEncoding: "ieee-p1363"}, Buffer.from(signature, "base64")) ? 0 : 1)' ${publicKey} '${signedMessage}' ${signature}`,
			)
		},
		slowStepTimeout,
	)

	test(
		"verifies every archived release with the root key and the image's Node",
		async () => {
			const results = await verifyArchivedReleasesOnDevice(umbreld, ARCHIVE_DIRECTORY)
			expect(results.filter((result) => 'error' in result)).toEqual([])
		},
		slowStepTimeout,
	)

	describe('with a test root key', () => {
		const rootKey = createRootKey()

		beforeAll(async () => {
			carriedList = createSigningKeysList({date: '2026-01-01T00:00:00Z', keys: [signingKey(alice)], rootKey})
			await trustRootKey(umbreld, rootKey, carriedList)
		}, slowStepTimeout)

		test(
			'installs the Pi update bundle from a release signed by an approved key',
			async () => {
				// With the devices the release manifest script pins for each bundle, so they're the ones a Pi reports
				const otherHash = `sha512-256:${'1'.repeat(64)}`
				const files = await createReleaseManifestFiles({
					'umbrelos-amd64-legacy.update': otherHash,
					'umbrelos-amd64.update': otherHash,
					'umbrelos-pi.update': unmatchedBundleHash,
				})
				const release = await publish({signer: alice, files})
				const {cursor} = await readUmbreldLogs(umbreld)

				// There's no Pi bundle on the release server, so Rugix fails once it's been asked to install it
				expect((await installLatestRelease(umbreld)).success).toBe(false)
				expect(release.bundleRequested()).toBe(true)
				expect((await readUmbreldLogs(umbreld, cursor)).logs).toContain(
					`Installing umbrelOS 99.0.0 from http://${testHostAddress}:${releases.port}/${release.id}/ signed by alice-mbp-2026`,
				)
			},
			slowStepTimeout,
		)

		test(
			'refuses a release changed after it was signed',
			async () => {
				const release = await publish({
					signer: alice,
					tamper: (manifest) => manifest.replace(/bundle:\S+/, `bundle:sha512-256:${'1'.repeat(64)}`),
				})
				await expect(installLatestRelease(umbreld)).resolves.toEqual({
					success: false,
					error: 'This release has an invalid signature from alice-mbp-2026',
				})
				expect(release.bundleRequested()).toBe(false)
			},
			slowStepTimeout,
		)

		test(
			'needs two signers once the list a release carries requires them',
			async () => {
				const twoSignerList = createSigningKeysList({
					date: '2026-02-01T00:00:00Z',
					requiredSignatures: 2,
					keys: [signingKey(alice), signingKey(bob)],
					rootKey,
				})

				const singleSigner = await publish({signer: alice, signingKeysList: twoSignerList})
				await expect(installLatestRelease(umbreld)).resolves.toEqual({
					success: false,
					error: 'This release has 1 of the 2 signatures it needs from approved keys',
				})
				expect(singleSigner.bundleRequested()).toBe(false)

				const twoSigners = await publish({signers: [alice, bob], signingKeysList: twoSignerList})
				const {cursor} = await readUmbreldLogs(umbreld)
				expect((await installLatestRelease(umbreld)).success).toBe(false)
				expect(twoSigners.bundleRequested()).toBe(true)
				expect((await readUmbreldLogs(umbreld, cursor)).logs).toContain('signed by alice-mbp-2026 and bob-mbp-2025')
			},
			slowStepTimeout * 2,
		)
	})
})
