import crypto from 'node:crypto'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'

import {getArch, installRelease, type InstallStatus} from './install-release.ts'
import {ReleaseVerificationError, UpdateError, parseReleaseManifest, type ReleaseFile} from './release-signing.ts'
import {createManifest} from '../test-utilities/release-signing.ts'

vi.mock('../system/system.ts', () => ({detectDevice: vi.fn(async () => ({deviceId: 'umbrel-home'}))}))

const arch = getArch()
const otherArch = arch === 'amd64' ? 'arm64' : 'amd64'
const bundleHash = (byte: string) => `sha512-256:${byte.repeat(32)}`

// A stand-in rugix-ctrl on the PATH that reports the boot flow in BOOT_FLOW and records the arguments it's
// asked to install with, and a release server for update scripts
let directory: string
let originalPath: string | undefined
let server: http.Server
let releaseUrl: string
let served: Record<string, string>

beforeAll(async () => {
	directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-install-release-test-'))
	await fse.writeFile(
		`${directory}/rugix-ctrl`,
		[
			'#!/usr/bin/env bash',
			'if [[ "$1" == system ]]; then printf \'{"boot":{"bootFlow":"%s"}}\\n\' "$BOOT_FLOW"; exit; fi',
			`printf '%s\\n' "$@" > "${directory}/installed"`,
			'echo \'{"event":"UpdateProgress","progress":50}\'',
		].join('\n'),
		{mode: 0o755},
	)
	originalPath = process.env.PATH
	process.env.PATH = `${directory}:${process.env.PATH}`

	server = http.createServer((request, response) => {
		const body = served[request.url ?? '']
		response.writeHead(body === undefined ? 404 : 200)
		response.end(body)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	releaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/release/`
})

afterAll(async () => {
	process.env.PATH = originalPath
	server.closeAllConnections()
	await new Promise((resolve) => server.close(resolve))
	await fse.remove(directory)
})

beforeEach(async () => {
	process.env.BOOT_FLOW = 'grub'
	served = {}
	await fse.remove(`${directory}/installed`)
	await fse.remove(`${directory}/script-ran`)
})

const installed = async () =>
	(await fse.pathExists(`${directory}/installed`))
		? (await fse.readFile(`${directory}/installed`, 'utf8')).trim().split('\n')
		: undefined

// Install a release with these files, and an update script serving as given
async function install(files: Record<string, ReleaseFile>, {script}: {script?: string} = {}) {
	if (script !== undefined) served['/release/update.sh'] = script
	const manifest = createManifest('2.1.0', {files})
	const statuses: InstallStatus[] = []
	await installRelease({
		releaseUrl,
		manifest,
		release: parseReleaseManifest(manifest),
		installedVersion: '2.0.0',
		onStatus: (status) => statuses.push(status),
	})
	return statuses
}

const bundle = (byte: string, details: Partial<ReleaseFile> = {}): ReleaseFile => ({
	sha256: 'ef'.repeat(32),
	bundle: bundleHash(byte),
	bootFlow: 'grub',
	arch,
	...details,
})

const updateScript = (script: string, details: Partial<ReleaseFile> = {}): ReleaseFile => ({
	sha256: crypto.createHash('sha256').update(script).digest('hex'),
	type: 'update-script',
	...details,
})

const script = (...lines: string[]) => ['#!/usr/bin/env bash', 'set -euo pipefail', ...lines, ''].join('\n')

describe('getArch()', () => {
	test.each([
		['x64', 'amd64'],
		['arm64', 'arm64'],
	])("names Node's %s by Debian's name for it, %s, like release manifests do", (nodeArch, debianArch) => {
		const original = Object.getOwnPropertyDescriptor(process, 'arch')!
		Object.defineProperty(process, 'arch', {value: nodeArch})
		try {
			expect(getArch()).toBe(debianArch)
		} finally {
			Object.defineProperty(process, 'arch', original)
		}
	})
})

describe('installRelease()', () => {
	test("installs the first bundle for the device's boot flow and architecture with its bundle hash", async () => {
		process.env.BOOT_FLOW = 'rpi-tryboot'
		const statuses = await install({
			'umbrelos-amd64.update': bundle('01'),
			'umbrelos-other-arch.update': bundle('02', {bootFlow: 'rpi-tryboot', arch: otherArch}),
			'umbrelos-pi.update': bundle('03', {bootFlow: 'rpi-tryboot'}),
			'umbrelos-pi-special.update': bundle('04', {bootFlow: 'rpi-tryboot'}),
		})
		expect(await installed()).toEqual([
			'update',
			'install',
			'--reboot',
			'set',
			'--bundle-hash',
			bundleHash('03'),
			`${releaseUrl}umbrelos-pi.update`,
		])
		expect(statuses).toEqual([{progress: 50}])
	})

	test.each<[string, Record<string, ReleaseFile>]>([
		['without a bundle for the boot flow', {'umbrelos-pi.update': bundle('01', {bootFlow: 'rpi-tryboot'})}],
		['without a bundle for the architecture', {'umbrelos-amd64.update': bundle('01', {arch: otherArch})}],
		[
			"with only bundles that don't say which devices they're for",
			{'umbrelos-amd64.update': {sha256: 'ef'.repeat(32), bundle: bundleHash('01')}},
		],
		[
			'with only a file for the device that has no bundle hash',
			{'umbrelos-amd64.img': bundle('01', {bundle: undefined})},
		],
	])('refuses a release %s', async (_description, files) => {
		await expect(install(files)).rejects.toThrow(
			new UpdateError("umbrelOS 2.1.0 doesn't include an update for this device"),
		)
		expect(await installed()).toBeUndefined()
	})

	describe('with an update script', () => {
		test('runs it before installing the bundle, with what it needs to know', async () => {
			const environment = script(
				`env | grep ^UMBREL_ | LC_ALL=C sort > "${directory}/script-ran"`,
				'cat "$UMBREL_RELEASE_MANIFEST" >> "' + directory + '/script-ran"',
			)
			await install(
				{'umbrelos-amd64.update': bundle('01'), 'update.sh': updateScript(environment)},
				{script: environment},
			)

			const ran = await fse.readFile(`${directory}/script-ran`, 'utf8')
			expect(ran.split('\n').filter((line) => line.startsWith('UMBREL_'))).toEqual([
				`UMBREL_ARCH=${arch}`,
				'UMBREL_BOOT_FLOW=grub',
				'UMBREL_DEVICE_ID=umbrel-home',
				'UMBREL_INSTALLED_VERSION=2.0.0',
				expect.stringMatching(/^UMBREL_RELEASE_MANIFEST=\/.+\/manifest\.txt$/),
				`UMBREL_RELEASE_URL=${releaseUrl}`,
				'UMBREL_RELEASE_VERSION=2.1.0',
				'UMBREL_UPDATE_BUNDLE=umbrelos-amd64.update',
				`UMBREL_UPDATE_BUNDLE_HASH=${bundleHash('01')}`,
				'UMBREL_UPDATE_SCRIPT_INTERFACE=1',
			])
			// The manifest it's given is the one that was verified
			expect(ran).toContain('--- umbrelOS Manifest ---\nSchema: 1\nVersion: 2.1.0\n')
			expect((await installed())?.at(-1)).toBe(`${releaseUrl}umbrelos-amd64.update`)
		})

		test('reports its progress, and Rugix progress from installs it runs', async () => {
			const reporting = script(
				'echo \'umbrel-update: {"progress": 10, "description": "Migrating..."}\'',
				'echo "Some other output"',
				"echo 'umbrel-update: not JSON'",
				'echo \'{"event":"UpdateProgress","progress":30.7}\'',
			)
			const statuses = await install(
				{'umbrelos-amd64.update': bundle('01'), 'update.sh': updateScript(reporting)},
				{script: reporting},
			)
			expect(statuses).toEqual([{progress: 10, description: 'Migrating...'}, {progress: 30.7}, {progress: 50}])
		})

		test("doesn't install the bundle when it installed the release itself", async () => {
			const takeover = script(`touch "${directory}/script-ran"`, 'echo \'umbrel-update: {"installed": true}\'')
			await install({'umbrelos-amd64.update': bundle('01'), 'update.sh': updateScript(takeover)}, {script: takeover})
			expect(await fse.pathExists(`${directory}/script-ran`)).toBe(true)
			expect(await installed()).toBeUndefined()
		})

		test("can install a release that doesn't have a bundle for the device", async () => {
			process.env.BOOT_FLOW = 'u-boot'
			const takeover = script('echo \'umbrel-update: {"installed": true}\'')
			await expect(
				install({'umbrelos-amd64.update': bundle('01'), 'update.sh': updateScript(takeover)}, {script: takeover}),
			).resolves.toBeDefined()

			const fixOnly = script('true')
			await expect(
				install({'umbrelos-amd64.update': bundle('01'), 'update.sh': updateScript(fixOnly)}, {script: fixOnly}),
			).rejects.toThrow("umbrelOS 2.1.0 doesn't include an update for this device")
		})

		test.each([
			[
				'the error it reports',
				script('echo \'umbrel-update: {"error": "Free up 2 GB to update"}\'', 'exit 1'),
				'Free up 2 GB to update',
			],
			['a generic error without one', script('exit 3'), 'The update script failed'],
		])('stops the update when it fails, showing %s', async (_description, failing, error) => {
			await expect(
				install({'umbrelos-amd64.update': bundle('01'), 'update.sh': updateScript(failing)}, {script: failing}),
			).rejects.toThrow(new UpdateError(error))
			expect(await installed()).toBeUndefined()
		})

		test("never runs a script that doesn't match the signed release", async () => {
			const signed = script('true')
			const tampered = script(`touch "${directory}/script-ran"`)
			await expect(
				install({'umbrelos-amd64.update': bundle('01'), 'update.sh': updateScript(signed)}, {script: tampered}),
			).rejects.toThrow(new ReleaseVerificationError("The update script doesn't match the signed release"))
			expect(await fse.pathExists(`${directory}/script-ran`)).toBe(false)
			expect(await installed()).toBeUndefined()
		})

		test("doesn't install a release whose script can't be downloaded", async () => {
			await expect(
				install({'umbrelos-amd64.update': bundle('01'), 'update.sh': updateScript(script('true'))}),
			).rejects.toThrow('Failed to download the update script: HTTP 404')
			expect(await installed()).toBeUndefined()
		})

		test("runs the first script for the device's boot flow and architecture", async () => {
			const other = script(`echo other > "${directory}/script-ran"`)
			const mine = script(`echo mine > "${directory}/script-ran"`)
			const later = script(`echo later > "${directory}/script-ran"`)
			served['/release/other.sh'] = other
			served['/release/later.sh'] = later
			await install(
				{
					'umbrelos-amd64.update': bundle('01'),
					'other.sh': updateScript(other, {bootFlow: 'rpi-tryboot'}),
					'other-arch.sh': updateScript(other, {arch: otherArch}),
					'update.sh': updateScript(mine, {bootFlow: 'grub', arch}),
					'later.sh': updateScript(later),
				},
				{script: mine},
			)
			expect(await fse.readFile(`${directory}/script-ran`, 'utf8')).toBe('mine\n')
		})
	})
})
