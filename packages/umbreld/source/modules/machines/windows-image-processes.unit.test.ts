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

import {prepareWindowsInstallMedia} from './windows-image.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	execaMock.mockClear()
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
