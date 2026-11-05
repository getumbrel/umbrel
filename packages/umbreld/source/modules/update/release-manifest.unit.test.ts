import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {$} from 'execa'
import fse from 'fs-extra'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {findUpdateBundle, parseReleaseManifest} from './release-signing.ts'

const script = fileURLToPath(new URL('../../../../os/create-release-manifest.sh', import.meta.url))
const {version, versionName} = await fse.readJson(fileURLToPath(new URL('../../../package.json', import.meta.url)))
const bundleHash = `sha512-256:${'ab'.repeat(32)}`
const dockerImage = `ghcr.io/getumbrel/umbrelos@sha256:${'cd'.repeat(32)}`

// CI writes the manifest with create-release-manifest.sh and devices parse it with parseReleaseManifest(),
// so the two have to agree
describe('create-release-manifest.sh', () => {
	let directory: string
	let releaseDirectory: string
	let environment: Record<string, string>

	const createManifest = async (extraEnvironment: Record<string, string> = {}) => {
		await $({env: {...environment, ...extraEnvironment}})`${script} ${releaseDirectory}`
		return fse.readFile(`${releaseDirectory}/manifest.txt`, 'utf8')
	}

	beforeEach(async () => {
		directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-release-manifest-test-'))
		releaseDirectory = `${directory}/release`
		environment = {BUILD_DIRECTORY: `${directory}/build`, RELEASE_NOTES_DIRECTORY: `${directory}/release-notes`}
		await fse.outputFile(`${releaseDirectory}/umbrelos-amd64.img.xz`, 'image')
		await fse.outputFile(`${releaseDirectory}/umbrelos-amd64.update`, 'bundle')
		await fse.outputFile(`${directory}/build/umbrelos-amd64.update.hash`, `${bundleHash}\n`)
	})

	afterEach(async () => {
		await fse.remove(directory)
	})

	test('writes a manifest devices can parse, pinning every file, and the release notes', async () => {
		await fse.outputFile(
			`${directory}/release-notes/${version}.md`,
			"## What's new\n\n- Signed updates — à la carte ✨\n",
		)

		const release = parseReleaseManifest(await createManifest({RELEASE_TAG: version, DOCKER_IMAGE: dockerImage}))
		expect(release.version).toBe(version)
		// What the release calls itself once it's installed
		expect(release.name).toBe(versionName)
		expect(release.dockerImage).toBe(dockerImage)
		// Dated by the commit it was built from, which it names so the release can be rebuilt from it
		const {stdout: commitTime} = await $`git log -1 --format=%ct`
		expect(release.date.getTime()).toBe(Number(commitTime) * 1000)
		const {stdout: commit} = await $`git rev-parse HEAD`
		expect(await fse.readFile(`${releaseDirectory}/manifest.txt`, 'utf8')).toContain(`\nCommit: ${commit}\n`)
		expect(release.files).toEqual({
			'umbrelos-amd64.img.xz': {sha256: '6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d'},
			'umbrelos-amd64.update': {
				sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
				bundle: bundleHash,
				bootFlow: 'grub',
				arch: 'amd64',
			},
		})
		expect(await fse.readFile(`${releaseDirectory}/release-notes.md`, 'utf8')).toBe(
			"## What's new\n\n- Signed updates — à la carte ✨\n",
		)
	})

	// They're signed separately, so the release notes can change without the manifest
	test("doesn't pin the release's own files", async () => {
		await fse.outputFile(`${releaseDirectory}/manifest.txt.sig`, 'signature')
		await fse.outputFile(`${releaseDirectory}/release-notes.md.sig`, 'signature')
		await fse.outputFile(`${releaseDirectory}/manifest.txt.ots`, 'timestamp')
		await createManifest()
		const {files} = parseReleaseManifest(await createManifest())
		expect(Object.keys(files).sort()).toEqual(['umbrelos-amd64.img.xz', 'umbrelos-amd64.update'])
	})

	// Every update bundle the release job builds, as build.sh names them. build.sh records a bundle hash
	// for each except Mender's migration bundles, which only the legacy update script installs.
	test('pins the devices that install each update bundle a release has', async () => {
		for (const bundle of ['umbrelos-amd64-legacy', 'umbrelos-pi']) {
			await fse.outputFile(`${releaseDirectory}/${bundle}.update`, 'bundle')
			await fse.outputFile(`${directory}/build/${bundle}.update.hash`, `${bundleHash}\n`)
		}
		for (const bundle of ['umbrelos-amd64-legacy-migration', 'umbrelos-pi-legacy-migration']) {
			await fse.outputFile(`${releaseDirectory}/${bundle}.update`, 'bundle')
		}

		const release = parseReleaseManifest(await createManifest())
		expect(Object.entries(release.files).filter(([, file]) => file.bundle)).toEqual([
			['umbrelos-amd64-legacy.update', expect.objectContaining({bootFlow: 'mender-grub', arch: 'amd64'})],
			['umbrelos-amd64.update', expect.objectContaining({bootFlow: 'grub', arch: 'amd64'})],
			['umbrelos-pi.update', expect.objectContaining({bootFlow: 'rpi-tryboot', arch: 'arm64'})],
		])
		expect(release.files['umbrelos-pi-legacy-migration.update']).toEqual({sha256: expect.any(String)})

		// What each kind of device in the field installs from it
		for (const [bootFlow, arch, bundle] of [
			['grub', 'amd64', 'umbrelos-amd64.update'],
			['mender-grub', 'amd64', 'umbrelos-amd64-legacy.update'],
			['rpi-tryboot', 'arm64', 'umbrelos-pi.update'],
		]) {
			expect(findUpdateBundle(release, {bootFlow, arch})?.name).toBe(bundle)
		}
	})

	test("pins a release's update script", async () => {
		const script = '#!/usr/bin/env bash\n'
		await fse.outputFile(`${releaseDirectory}/update.sh`, script)
		const {files} = parseReleaseManifest(await createManifest())
		expect(files['update.sh']).toEqual({
			sha256: crypto.createHash('sha256').update(script).digest('hex'),
			type: 'update-script',
		})
	})

	test('writes schema 1, which the documented shasum check reads', async () => {
		const manifest = await createManifest()
		expect(manifest.split('\n').slice(0, 2)).toEqual(['--- umbrelOS Manifest ---', 'Schema: 1'])

		const check = (await fse.readFile(script, 'utf8')).match(/^#   (awk .*)$/m)![1]
		await expect($({cwd: releaseDirectory})`bash -c ${check}`).resolves.toMatchObject({
			stdout: expect.stringContaining('umbrelos-amd64.img.xz: OK'),
		})
		await fse.outputFile(`${releaseDirectory}/umbrelos-amd64.img.xz`, 'tampered')
		await expect($({cwd: releaseDirectory})`bash -c ${check}`).rejects.toThrow('umbrelos-amd64.img.xz: FAILED')
	})

	// So the same release always gives the same manifest
	test('is the same each time for the same release', async () => {
		const manifest = await createManifest({SOURCE_DATE_EPOCH: '1793000000'})
		expect(parseReleaseManifest(manifest).date).toEqual(new Date(1793000000 * 1000))
		await fse.outputFile(`${releaseDirectory}/umbrelos-amd64-legacy.update`, 'bundle')
		await fse.outputFile(`${directory}/build/umbrelos-amd64-legacy.update.hash`, `${bundleHash}\n`)
		const withLegacy = await createManifest({
			SOURCE_DATE_EPOCH: '1793000000',
			LC_ALL: 'en_US.UTF-8',
			LANG: 'en_US.UTF-8',
		})
		expect(await createManifest({SOURCE_DATE_EPOCH: '1793000000', LC_ALL: 'C'})).toBe(withLegacy)
		// In byte order, whatever the locale
		expect(withLegacy.match(/^File: \S+/gm)).toEqual([
			'File: umbrelos-amd64-legacy.update',
			'File: umbrelos-amd64.img.xz',
			'File: umbrelos-amd64.update',
		])
	})

	test('names the commit as unknown outside a Git checkout', async () => {
		const manifest = await createManifest({GIT_DIR: `${directory}/not-a-repository`, SOURCE_DATE_EPOCH: '1793000000'})
		expect(manifest).toContain('\nCommit: unknown\n')
		expect(parseReleaseManifest(manifest).date).toEqual(new Date(1793000000 * 1000))
	})

	test("doesn't need release notes for a test build", async () => {
		await createManifest({RELEASE_TAG: 'public-test-build', DOCKER_IMAGE: dockerImage})
		expect(await fse.readFile(`${releaseDirectory}/release-notes.md`, 'utf8')).toBe('')
	})

	test.each([
		{
			failure: "a tag that isn't umbreld's version",
			error: "tag doesn't match umbreld's version",
			setup: async () => ({RELEASE_TAG: '99.0.0'}),
		},
		{
			failure: 'a release tag without release notes',
			error: 'Release notes for',
			setup: async () => ({RELEASE_TAG: version, DOCKER_IMAGE: dockerImage}),
		},
		{
			failure: 'a release tag without its Docker image',
			error: 'DOCKER_IMAGE is missing',
			setup: async () => ({RELEASE_TAG: 'public-test-build'}),
		},
		...[
			'ghcr.io/getumbrel/umbrelos:2.1.0',
			`ghcr.io/getumbrel/umbrelos:2.1.0@sha256:${'cd'.repeat(32)}`,
			`umbrelos@sha256:${'cd'.repeat(32)}`,
			`ghcr.io/getumbrel/umbrelos@sha256:${'cd'.repeat(31)}`,
		].map((image) => ({
			failure: `the Docker image ${image}`,
			error: 'DOCKER_IMAGE has to be an image by its digest',
			setup: async () => ({DOCKER_IMAGE: image}),
		})),
		{
			failure: "a file name devices can't parse",
			error: 'Release file names can only contain',
			setup: async () => {
				await fse.outputFile(`${releaseDirectory}/umbrelos amd64.img`, 'image')
				return {}
			},
		},
		{
			failure: "an update bundle it doesn't know the devices for",
			error: 'No devices install umbrelos-pi5.update',
			setup: async () => {
				await fse.outputFile(`${releaseDirectory}/umbrelos-pi5.update`, 'bundle')
				await fse.outputFile(`${directory}/build/umbrelos-pi5.update.hash`, `${bundleHash}\n`)
				return {}
			},
		},
		{
			failure: 'an update bundle without a bundle hash',
			error: 'No bundle hash for umbrelos-amd64.update',
			setup: async () => {
				await fse.remove(`${directory}/build`)
				return {}
			},
		},
		{
			failure: 'a release without update bundles',
			error: 'No update bundles found',
			setup: async () => {
				await fse.remove(`${releaseDirectory}/umbrelos-amd64.update`)
				return {}
			},
		},
	])('fails on $failure', async ({setup, error}) => {
		await expect(createManifest(await setup())).rejects.toThrow(error)
		expect(await fse.pathExists(`${releaseDirectory}/manifest.txt`)).toBe(false)
	})
})
