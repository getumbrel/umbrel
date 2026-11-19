import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, expect, test, vi} from 'vitest'

import {
	MACHINE_INSTALL_CLEANUP_TIMEOUT_MS,
	MACHINE_INSTALL_COMMAND_TIMEOUT_MS,
	MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS,
} from './install-command.ts'

const execaMock = vi.hoisted(() =>
	vi.fn(async (command: string, arguments_: string[]) => {
		if (command === 'bsdtar') return {stdout: 'boot/etfsboot.com\nefi/microsoft/boot/efisys_noprompt.bin\n'}
		if (command === 'mount') {
			const mountpoint = arguments_.at(-1)!
			await fse.outputFile(nodePath.join(mountpoint, 'boot/etfsboot.com'), '')
			await fse.outputFile(nodePath.join(mountpoint, 'efi/microsoft/boot/efisys_noprompt.bin'), '')
		}
		return {stdout: '', stderr: '', exitCode: 0}
	}),
)

vi.mock('execa', () => ({execa: execaMock}))

// Every tool but mount and umount runs sandboxed. Here they all land in the
// same mock, with what each was allowed recorded beside it.
const sandboxes = vi.hoisted(() => [] as Array<[string, Record<string, unknown>]>)
vi.mock('../utilities/sandbox.ts', () => ({
	sandboxed: (command: string, arguments_: string[], sandbox: Record<string, unknown>, options: unknown) => {
		sandboxes.push([command, sandbox])
		return (execaMock as any)(command, arguments_, options)
	},
}))

import {prepareWindowsInstallMedia} from './windows-image.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	execaMock.mockClear()
	sandboxes.length = 0
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fse.remove(directory)))
})

test('cancels and bounds Windows media preparation while keeping cleanup independent', async () => {
	const directory = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-windows-media-'))
	temporaryDirectories.push(directory)
	const source = nodePath.join(directory, 'source.iso')
	const destination = nodePath.join(directory, 'destination.iso')
	await fsp.writeFile(source, '')
	const controller = new AbortController()

	await prepareWindowsInstallMedia(
		source,
		destination,
		{
			installer: 'windows-11',
			arch: 'amd64',
			username: 'umbrel',
			password: 'password',
			completionUrl: 'http://10.203.0.1/complete',
		},
		controller.signal,
	)

	const calls = execaMock.mock.calls as unknown as Array<[string, string[], Record<string, unknown>]>
	const optionsFor = (command: string) => calls.find(([candidate]) => candidate === command)?.[2]
	expect(optionsFor('bsdtar')).toEqual({
		signal: controller.signal,
		timeout: MACHINE_INSTALL_COMMAND_TIMEOUT_MS,
		cleanup: true,
		maxBuffer: 100 * 1024 * 1024,
	})
	expect(optionsFor('mount')).toEqual({
		signal: controller.signal,
		timeout: MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS,
		cleanup: true,
	})
	expect(optionsFor('genisoimage')).toEqual({
		signal: controller.signal,
		timeout: MACHINE_INSTALL_COMMAND_TIMEOUT_MS,
		cleanup: true,
	})
	expect(optionsFor('umount')).toEqual({reject: false, timeout: MACHINE_INSTALL_CLEANUP_TIMEOUT_MS})
	expect(optionsFor('chmod')).toEqual({reject: false, timeout: MACHINE_INSTALL_CLEANUP_TIMEOUT_MS})
})

test('runs every tool that reads or writes install media in a sandbox that sees only that media', async () => {
	const directory = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-windows-media-'))
	temporaryDirectories.push(directory)
	const source = nodePath.join(directory, 'images', 'source.iso')
	const destination = nodePath.join(directory, 'media', 'destination.iso')
	await fse.outputFile(source, '')
	await fse.ensureDir(nodePath.dirname(destination))

	await prepareWindowsInstallMedia(
		source,
		destination,
		{
			installer: 'windows-7',
			arch: 'amd64',
			username: 'umbrel',
			password: 'password',
			completionUrl: 'http://10.203.0.1/complete',
		},
		new AbortController().signal,
	)

	const overlay = expect.stringMatching(new RegExp(`^${destination}\\.\\d+\\.\\d+\\.overlay$`))
	const confined = {network: false, gpu: false, user: 'root'}
	expect(sandboxes).toEqual([
		// Listing the source disc
		['bsdtar', {...confined, readablePaths: [source], writablePaths: []}],
		// Building the media beside the working directory
		['genisoimage', {...confined, readablePaths: [], writablePaths: [nodePath.dirname(destination)]}],
		// Cleaning up the working directory
		['chmod', {...confined, readablePaths: [], writablePaths: [overlay]}],
	])
	// Only the kernel's own mount and unmount run outside it
	const calls = execaMock.mock.calls as unknown as Array<[string]>
	const unsandboxed = calls
		.map(([command]) => command)
		.filter((command) => !sandboxes.some(([name]) => name === command))
	expect(unsandboxed).toEqual(['mount', 'umount'])
})
