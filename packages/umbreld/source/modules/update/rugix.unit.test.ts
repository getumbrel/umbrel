import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest'

import {getBootFlow, installUpdateBundle} from './rugix.ts'

// A stand-in rugix-ctrl on the PATH that records its arguments and replays the output in RUGIX_OUTPUT
let directory: string
let originalPath: string | undefined

beforeAll(async () => {
	directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-rugix-test-'))
	await fse.writeFile(
		`${directory}/rugix-ctrl`,
		`#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${directory}/arguments"\nprintf '%b' "$RUGIX_OUTPUT"\nexit "\${RUGIX_EXIT:-0}"\n`,
		{mode: 0o755},
	)
	originalPath = process.env.PATH
	process.env.PATH = `${directory}:${process.env.PATH}`
})

afterAll(async () => {
	process.env.PATH = originalPath
	await fse.remove(directory)
})

beforeEach(() => {
	delete process.env.RUGIX_OUTPUT
	delete process.env.RUGIX_EXIT
})

const rugixArguments = async () => (await fse.readFile(`${directory}/arguments`, 'utf8')).trim().split('\n')

describe('getBootFlow()', () => {
	test("reads the device's boot flow from Rugix", async () => {
		process.env.RUGIX_OUTPUT = JSON.stringify({boot: {bootFlow: 'rpi-tryboot'}})
		await expect(getBootFlow()).resolves.toBe('rpi-tryboot')
		expect(await rugixArguments()).toEqual(['system', 'info', '--json'])
	})

	test('is undefined for a device without one', async () => {
		process.env.RUGIX_OUTPUT = JSON.stringify({boot: null})
		await expect(getBootFlow()).resolves.toBeUndefined()
	})
})

describe('installUpdateBundle()', () => {
	const bundleHash = `sha512-256:${'ab'.repeat(32)}`

	test('has Rugix check the bundle against its bundle hash', async () => {
		await installUpdateBundle('https://download.umbrel.com/release/2.1.0/umbrelos-amd64.update', {bundleHash})
		expect(await rugixArguments()).toEqual([
			'update',
			'install',
			'--reboot',
			'set',
			'--bundle-hash',
			bundleHash,
			'https://download.umbrel.com/release/2.1.0/umbrelos-amd64.update',
		])
	})

	test('only skips verification when asked to', async () => {
		await installUpdateBundle('/tmp/umbrelos-amd64.update', {insecureSkipVerification: true})
		expect(await rugixArguments()).toEqual([
			'update',
			'install',
			'--reboot',
			'set',
			'--insecure-skip-bundle-verification',
			'/tmp/umbrelos-amd64.update',
		])
	})

	test('reports progress in 0.1% steps', async () => {
		process.env.RUGIX_OUTPUT = [10.21, 10.25, 10.8, 55, 100]
			.map((progress) => `{"event":"UpdateProgress","progress":${progress}}`)
			.join('\\n')
		const progress: number[] = []
		await installUpdateBundle('bundle', {bundleHash}, (value) => progress.push(value))
		expect(progress).toEqual([10.2, 10.8, 55, 100])
	})

	test("reports a bundle that doesn't match its bundle hash", async () => {
		process.env.RUGIX_OUTPUT = 'Error: invalid header hash\\n'
		process.env.RUGIX_EXIT = '1'
		await expect(installUpdateBundle('bundle', {bundleHash})).rejects.toThrow(
			"The update bundle doesn't match the signed release",
		)
	})

	test('passes on other failures', async () => {
		process.env.RUGIX_OUTPUT = 'Error: no space left on device\\n'
		process.env.RUGIX_EXIT = '1'
		await expect(installUpdateBundle('bundle', {bundleHash})).rejects.toThrow('no space left on device')
	})
})
