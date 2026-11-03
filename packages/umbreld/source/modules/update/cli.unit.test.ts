import process from 'node:process'

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {trpc} from '../cli-client.ts'
import {reboot} from '../system/system.ts'
import {installRelease} from './install-release.ts'
import {installUpdateBundle} from './rugix.ts'
import {downloadReleaseManifest} from './release-signing.ts'
import {updateCli} from './cli.ts'
import {createManifest} from '../test-utilities/release-signing.ts'

vi.mock('../cli-client.ts', () => ({
	trpc: {update: {check: {query: vi.fn()}, install: {mutate: vi.fn()}, status: {query: vi.fn()}}},
}))
vi.mock('../system/system.ts', () => ({reboot: vi.fn()}))
vi.mock('./rugix.ts', () => ({installUpdateBundle: vi.fn()}))
vi.mock('./install-release.ts', () => ({installRelease: vi.fn()}))
vi.mock('./release-signing.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('./release-signing.ts')>()),
	downloadReleaseManifest: vi.fn(),
}))
vi.mock('node:timers/promises', () => ({setTimeout: vi.fn(async () => undefined)}))

const idle = {running: false, progress: 0, description: '', error: false as string | false}
const latest = {available: true, version: '2.1.0', name: 'umbrelOS 2.1', releaseNotes: ''}
const runAs = (uid: number) => vi.spyOn(process as {getuid(): number}, 'getuid').mockReturnValue(uid)

describe('umbreld update', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.mocked(trpc.update.status.query).mockResolvedValue(idle)
		vi.mocked(trpc.update.check.query).mockResolvedValue(latest)
		process.exitCode = undefined
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.mocked(trpc.update.install.mutate).mockReset()
		vi.mocked(trpc.update.status.query).mockReset()
		vi.mocked(installUpdateBundle).mockReset()
		vi.mocked(installRelease).mockReset()
		vi.mocked(reboot).mockReset()
		process.exitCode = undefined
	})

	test.each([[['--skip-signature-check']], [['a', 'b']], [['--skip-signature-check', 'a', 'b']]])(
		'shows usage for %j',
		async (args) => {
			await updateCli(args)
			expect(process.exitCode).toBe(1)
			expect(trpc.update.install.mutate).not.toHaveBeenCalled()
			expect(installUpdateBundle).not.toHaveBeenCalled()
		},
	)

	describe('--skip-signature-check', () => {
		test('installs the bundle without verification as root, then reboots', async () => {
			runAs(0)
			await updateCli(['--skip-signature-check', '/tmp/umbrelos-amd64.update'])
			expect(installUpdateBundle).toHaveBeenCalledWith(
				'/tmp/umbrelos-amd64.update',
				{insecureSkipVerification: true},
				expect.any(Function),
			)
			expect(reboot).toHaveBeenCalled()
			// It never goes through umbreld's update API
			expect(trpc.update.install.mutate).not.toHaveBeenCalled()
		})

		test('needs root', async () => {
			runAs(1000)
			await expect(updateCli(['--skip-signature-check', 'bundle.update'])).rejects.toThrow('needs root')
			expect(installUpdateBundle).not.toHaveBeenCalled()
		})

		test("doesn't race an update umbreld is installing", async () => {
			runAs(0)
			vi.mocked(trpc.update.status.query).mockResolvedValue({...idle, running: true})
			await expect(updateCli(['--skip-signature-check', 'bundle.update'])).rejects.toThrow('already installing')
			expect(installUpdateBundle).not.toHaveBeenCalled()
		})

		test('installs a release from its URL, checking the bundle and update script against its manifest', async () => {
			runAs(0)
			const manifest = createManifest('2.0.0')
			vi.mocked(downloadReleaseManifest).mockResolvedValue(manifest)
			await updateCli(['--skip-signature-check', 'https://download.umbrel.com/public-test'])
			expect(downloadReleaseManifest).toHaveBeenCalledWith('https://download.umbrel.com/public-test/', 'umbreld update')
			expect(installRelease).toHaveBeenCalledWith({
				releaseUrl: 'https://download.umbrel.com/public-test/',
				manifest,
				release: expect.objectContaining({version: '2.0.0'}),
				installedVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
				onStatus: expect.any(Function),
			})
			expect(installUpdateBundle).not.toHaveBeenCalled()
			expect(reboot).toHaveBeenCalled()
		})

		test('prints whole percents of progress', async () => {
			runAs(0)
			vi.mocked(installUpdateBundle).mockImplementation(async (_bundle, _verification, onProgress) => {
				for (const progress of [0.4, 1.2, 1.9, 2]) onProgress?.(progress)
			})
			await updateCli(['--skip-signature-check', 'bundle.update'])
			expect(
				vi
					.mocked(console.log)
					.mock.calls.flat()
					.filter((line) => String(line).includes('%')),
			).toEqual(['Update progress: 0%', 'Update progress: 1%', 'Update progress: 2%'])
		})

		test("works when umbreld isn't running", async () => {
			runAs(0)
			vi.mocked(trpc.update.status.query).mockRejectedValue(new Error('ECONNREFUSED'))
			await updateCli(['--skip-signature-check', 'bundle.update'])
			expect(installUpdateBundle).toHaveBeenCalled()
		})
	})

	describe('without options', () => {
		test("does nothing when there's no newer release", async () => {
			vi.mocked(trpc.update.check.query).mockResolvedValue({...latest, available: false})
			await updateCli([])
			expect(trpc.update.install.mutate).not.toHaveBeenCalled()
		})

		test('installs the latest signed release through umbreld', async () => {
			vi.mocked(trpc.update.install.mutate).mockResolvedValue(true)
			await expect(updateCli([])).resolves.toBeUndefined()
			expect(trpc.update.install.mutate).toHaveBeenCalledWith({releaseUrl: undefined})
			expect(installUpdateBundle).not.toHaveBeenCalled()
		})

		test('installs a signed release by URL through umbreld, whatever its version', async () => {
			vi.mocked(trpc.update.check.query).mockResolvedValue({...latest, available: false})
			vi.mocked(trpc.update.install.mutate).mockResolvedValue(true)
			await expect(updateCli(['https://download.umbrel.com/public-test'])).resolves.toBeUndefined()
			expect(trpc.update.check.query).toHaveBeenCalledWith({releaseUrl: 'https://download.umbrel.com/public-test'})
			expect(trpc.update.install.mutate).toHaveBeenCalledWith({releaseUrl: 'https://download.umbrel.com/public-test'})
			expect(installRelease).not.toHaveBeenCalled()
		})

		test('reports why the update failed', async () => {
			vi.mocked(trpc.update.install.mutate).mockResolvedValue(false)
			vi.mocked(trpc.update.status.query).mockResolvedValue({
				...idle,
				error: 'This release is signed by an unapproved key (SHA256:x)',
			})
			await expect(updateCli([])).rejects.toThrow('unapproved key')
		})

		test('succeeds when umbreld restarts into the update before responding', async () => {
			let rejectInstall!: (error: Error) => void
			vi.mocked(trpc.update.install.mutate).mockReturnValue(new Promise((_, reject) => (rejectInstall = reject)))
			vi.mocked(trpc.update.status.query)
				.mockResolvedValueOnce({...idle, running: true, progress: 50})
				.mockResolvedValueOnce({running: false, progress: 100, description: 'Restarting...', error: false})
				.mockImplementation(async () => {
					rejectInstall(new Error('WebSocket closed'))
					throw new Error('WebSocket closed')
				})

			await expect(updateCli([])).resolves.toBeUndefined()
		})

		test('prints whole percents of progress', async () => {
			let resolveInstall!: (success: boolean) => void
			vi.mocked(trpc.update.install.mutate).mockReturnValue(new Promise((resolve) => (resolveInstall = resolve)))
			const statuses = [0.4, 1.2, 1.9, 2].map((progress) => ({...idle, running: true, progress}))
			vi.mocked(trpc.update.status.query).mockImplementation(async () => {
				const status = statuses.shift()
				if (!status) resolveInstall(true)
				return status ?? {running: false, progress: 100, description: 'Restarting...', error: false}
			})
			await updateCli([])
			expect(
				vi
					.mocked(console.log)
					.mock.calls.flat()
					.filter((line) => String(line).includes('%')),
			).toEqual(['Update progress: 0%', 'Update progress: 1%', 'Update progress: 2%'])
		})

		test("fails when the connection drops before it's installed", async () => {
			vi.mocked(trpc.update.install.mutate).mockReturnValue(new Promise(() => {}))
			vi.mocked(trpc.update.status.query)
				.mockResolvedValueOnce({...idle, running: true, progress: 50})
				.mockRejectedValue(new Error('WebSocket closed'))

			await expect(updateCli([])).rejects.toThrow('before the update installed')
		})

		test('reports an update that is already running', async () => {
			const conflict = Object.assign(new Error('An update is already running'), {data: {code: 'CONFLICT'}})
			vi.mocked(trpc.update.install.mutate).mockRejectedValue(conflict)
			// The other update's status
			vi.mocked(trpc.update.status.query).mockImplementation(async () => {
				await new Promise((resolve) => setImmediate(resolve))
				return {running: true, progress: 100, description: '', error: false}
			})

			await expect(updateCli([])).rejects.toThrow('An update is already running')
		})
	})
})
