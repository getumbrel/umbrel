import process from 'node:process'
import fsp from 'node:fs/promises'
import {inspect} from 'node:util'

import {TRPCError} from '@trpc/server'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import CloudRclone, {
	RcloneProcessError,
	activityFromRcloneStats,
	buildRcloneRemoteSource,
	cloudTransferBudget,
} from './cloud-rclone.js'
import {CLOUD_JUNK_FILTER} from './cloud-types.js'

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const SYNC_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = process.getuid?.() ?? 1000
const GROUP_ID = process.getgid?.() ?? 1000

const FAKE_RCLONE = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
const http = require('node:http')

const args = process.argv.slice(2)
const flag = (name) => args[args.indexOf(name) + 1]
const configPath = flag('--config')
if (args[0] !== 'rcd') {
	fs.writeFileSync(configPath + '.args', JSON.stringify(args))
	if (args[0] === 'lsjson') {
		try {
			process.stdout.write(fs.readFileSync(configPath + '.listing', 'utf8'))
		} catch {
			process.stdout.write('[]')
		}
	}
	process.exit(0)
}
const socketPath = flag('--rc-addr').slice('unix://'.length)
try { fs.unlinkSync(socketPath) } catch {}
const server = http.createServer((request) => request.resume())
const stop = (signal) => {
	fs.writeFileSync(configPath + '.signal', signal)
	server.close(() => process.exit(0))
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
// The socket signals readiness, so install handlers before exposing it.
server.listen(socketPath)
`

describe('CloudRclone', () => {
	let dataDirectory: string
	let fakeBinary: string
	let rclone: CloudRclone

	beforeEach(async () => {
		dataDirectory = await fsp.mkdtemp('/tmp/ci-')
		fakeBinary = `${dataDirectory}/fake-rclone`
		await fsp.writeFile(fakeBinary, FAKE_RCLONE, {mode: 0o755})
		rclone = new CloudRclone({
			dataDirectory,
			fileOwner: {userId: USER_ID, groupId: GROUP_ID},
			binary: fakeBinary,
		})
	})

	afterEach(async () => {
		await fsp.rm(dataDirectory, {recursive: true, force: true})
	})

	test('builds pinned provider sources without display-path fallback', () => {
		expect(
			buildRcloneRemoteSource('google-drive', {
				path: '/Displayed/Name',
				folderId: 'folder-id',
				sharedDriveId: 'shared-id',
			}),
		).toBe('cloud,team_drive=shared-id,root_folder_id=folder-id:')
		expect(
			buildRcloneRemoteSource('onedrive', {
				path: '/Displayed/Name',
				folderId: '01ABC!123',
				driveId: 'b!drive-id',
				driveType: 'business',
			}),
		).toBe('cloud,drive_id=b!drive-id,drive_type=business,root_folder_id=01ABC!123:')
		expect(buildRcloneRemoteSource('dropbox', {path: '/Shared/Photos/'})).toBe('cloud:Shared/Photos')
		expect(buildRcloneRemoteSource('icloud', {path: '/'})).toBe('cloud:')
		expect(() => buildRcloneRemoteSource('webdav', {path: '../escape'})).toThrow('[cloud-invalid-remote-path]')
		expect(() => buildRcloneRemoteSource('google-drive', {path: '/', folderId: 'bad,id'})).toThrow(
			'[cloud-invalid-remote-identity]',
		)
		expect(() => buildRcloneRemoteSource('webdav', {path: '/', folderId: 'replicated-provider-state'})).toThrow(
			'[cloud-invalid-remote]',
		)
	})

	test('derives determinate and indeterminate activity without false totals', () => {
		expect(
			activityFromRcloneStats(SYNC_ID, {
				bytes: 25,
				speed: 12.5,
				transfers: 1,
				totalTransfers: 4,
				totalBytes: 100,
			}),
		).toEqual({
			syncId: SYNC_ID,
			percent: 25,
			bytesPerSecond: 12.5,
			transferredFiles: 1,
			totalFiles: 4,
			transferredBytes: 25,
			totalBytes: 100,
		})
		expect(activityFromRcloneStats(SYNC_ID, {bytes: 0, speed: 0, transfers: 0, totalTransfers: 0})).toEqual({
			syncId: SYNC_ID,
			bytesPerSecond: 0,
			transferredFiles: 0,
			transferredBytes: 0,
		})
		expect(activityFromRcloneStats(SYNC_ID, {bytes: 1})).toBeUndefined()
	})

	test('reserves the free-space floor from each transfer budget', () => {
		const floor = 3n * 1024n * 1024n * 1024n
		expect(cloudTransferBudget(floor - 1n, floor)).toBeUndefined()
		expect(cloudTransferBudget(floor, floor)).toBeUndefined()
		expect(cloudTransferBudget(floor + 512n * 1024n, floor)).toBe(512n * 1024n)
	})

	test('renders bounded recent log records through tRPC errors', () => {
		const records = Array.from({length: 30}, (_, index) => ({
			level: 'error',
			msg: `record-${index}: ${'x'.repeat(4 * 1024)}`,
		}))
		const cause = new RcloneProcessError('sync', {code: 1, signal: null}, records)
		const rendered = inspect(new TRPCError({code: 'INTERNAL_SERVER_ERROR', cause}))

		expect(rendered).toContain('record-29:')
		expect(rendered).not.toContain('record-0:')
		expect(rendered).not.toContain('[Object]')
		expect(rendered.length).toBeLessThan(50_000)
	})

	test('returns a stable error code when no transfer budget remains', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = webdav\n', {mode: 0o600})

		await expect(
			rclone.sync({
				accountId: ACCOUNT_ID,
				provider: 'webdav',
				syncId: SYNC_ID,
				remote: {path: '/'},
				destination: dataDirectory,
				minimumFreeBytes: 1n << 62n,
			}),
		).rejects.toThrow('[cloud-destination-low-space]')
	})

	test('skips dangling shortcuts only for Google Drive syncs', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = drive\n', {mode: 0o600})

		await rclone.sync({
			accountId: ACCOUNT_ID,
			provider: 'google-drive',
			syncId: SYNC_ID,
			remote: {path: '/', folderId: 'folder-id'},
			destination: dataDirectory,
			minimumFreeBytes: 0n,
		})
		const googleArgs = JSON.parse(await fsp.readFile(`${paths.config}.args`, 'utf8')) as string[]
		expect(googleArgs).toContain('--drive-skip-dangling-shortcuts')

		await fsp.writeFile(paths.config, '[cloud]\ntype = dropbox\n')
		await rclone.sync({
			accountId: ACCOUNT_ID,
			provider: 'dropbox',
			syncId: SYNC_ID,
			remote: {path: '/'},
			destination: dataDirectory,
			minimumFreeBytes: 0n,
		})
		const dropboxArgs = JSON.parse(await fsp.readFile(`${paths.config}.args`, 'utf8')) as string[]
		expect(dropboxArgs).not.toContain('--drive-skip-dangling-shortcuts')
	})

	test('ignores provider-reported sizes only for iCloud syncs', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = iclouddrive\n', {mode: 0o600})

		await rclone.sync({
			accountId: ACCOUNT_ID,
			provider: 'icloud',
			syncId: SYNC_ID,
			remote: {path: '/'},
			destination: dataDirectory,
			minimumFreeBytes: 0n,
		})
		const icloudArgs = JSON.parse(await fsp.readFile(`${paths.config}.args`, 'utf8')) as string[]
		expect(icloudArgs).toContain('--ignore-size')

		await fsp.writeFile(paths.config, '[cloud]\ntype = dropbox\n')
		await rclone.sync({
			accountId: ACCOUNT_ID,
			provider: 'dropbox',
			syncId: SYNC_ID,
			remote: {path: '/'},
			destination: dataDirectory,
			minimumFreeBytes: 0n,
		})
		const dropboxArgs = JSON.parse(await fsp.readFile(`${paths.config}.args`, 'utf8')) as string[]
		expect(dropboxArgs).not.toContain('--ignore-size')
	})

	test('excludes Personal Vault only from personal OneDrive root syncs', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = onedrive\n', {mode: 0o600})

		const syncOneDrive = async (remote: {
			path: string
			folderId: string
			driveId: string
			driveType: 'personal' | 'business'
		}) => {
			await rclone.sync({
				accountId: ACCOUNT_ID,
				provider: 'onedrive',
				syncId: SYNC_ID,
				remote,
				destination: dataDirectory,
				minimumFreeBytes: 0n,
			})
			return JSON.parse(await fsp.readFile(`${paths.config}.args`, 'utf8')) as string[]
		}

		const personalRootArgs = await syncOneDrive({
			path: '/',
			folderId: 'personal-root',
			driveId: 'personal-drive',
			driveType: 'personal',
		})
		expect(personalRootArgs).toContain('--track-renames')
		expect(personalRootArgs).toContain('--filter')
		expect(personalRootArgs).toContain('- /Personal Vault/**')

		const businessRootArgs = await syncOneDrive({
			path: '/',
			folderId: 'business-root',
			driveId: 'business-drive',
			driveType: 'business',
		})
		expect(businessRootArgs).not.toContain('--filter')
		expect(businessRootArgs).not.toContain('- /Personal Vault/**')

		const personalFolderArgs = await syncOneDrive({
			path: '/Photos',
			folderId: 'photos',
			driveId: 'personal-drive',
			driveType: 'personal',
		})
		expect(personalFolderArgs).not.toContain('--filter')
		expect(personalFolderArgs).not.toContain('- /Personal Vault/**')
	})

	test('prioritizes smaller files without delaying the initial transfer', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = webdav\n', {mode: 0o600})

		await rclone.sync({
			accountId: ACCOUNT_ID,
			provider: 'webdav',
			syncId: SYNC_ID,
			remote: {path: '/'},
			destination: dataDirectory,
			minimumFreeBytes: 0n,
		})
		const args = JSON.parse(await fsp.readFile(`${paths.config}.args`, 'utf8')) as string[]
		const orderBy = args.indexOf('--order-by')
		expect(args.slice(orderBy, orderBy + 2)).toEqual(['--order-by', 'size,ascending'])
		expect(args).not.toContain('--check-first')
	})

	test('browses files without letting them crowd folders out of a capped result', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = webdav\n', {mode: 0o600})
		await fsp.writeFile(
			`${paths.config}.listing`,
			JSON.stringify([
				{Name: 'first.txt', Path: 'first.txt', IsDir: false, ID: 'ignored-file-id'},
				{Name: 'Photos', Path: 'Photos', IsDir: true, ID: 'photos-id'},
				{Name: 'second.txt', Path: 'second.txt', IsDir: false},
				{Name: 'Work', Path: 'Work', IsDir: true},
			]),
		)

		await expect(
			rclone.browse({
				accountId: ACCOUNT_ID,
				provider: 'webdav',
				remote: {path: '/'},
				maxEntries: 3,
			}),
		).resolves.toEqual({
			entries: [
				{name: 'Photos', path: 'Photos', type: 'directory', id: 'photos-id'},
				{name: 'Work', path: 'Work', type: 'directory'},
				{name: 'first.txt', path: 'first.txt', type: 'file'},
			],
			truncated: true,
		})

		const args = JSON.parse(await fsp.readFile(`${paths.config}.args`, 'utf8')) as string[]
		expect(args).not.toContain('--dirs-only')
		expect(args.slice(args.indexOf('--filter-from'), args.indexOf('--filter-from') + 2)).toEqual([
			'--filter-from',
			paths.filter,
		])
	})

	test('rejects browse entries without an explicit directory discriminator', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = webdav\n', {mode: 0o600})
		await fsp.writeFile(`${paths.config}.listing`, JSON.stringify([{Name: 'ambiguous', Path: 'ambiguous'}]))

		await expect(
			rclone.browse({
				accountId: ACCOUNT_ID,
				provider: 'webdav',
				remote: {path: '/'},
			}),
		).rejects.toThrow('[cloud-invalid-rclone-listing]')
	})

	test('accepts only canonical account configs with the expected provider', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = webdav\n', {mode: 0o600})

		await expect(rclone.hasCanonicalConfig(ACCOUNT_ID, 'webdav')).resolves.toBe(true)
		await expect(rclone.hasCanonicalConfig(ACCOUNT_ID, 'dropbox')).resolves.toBe(false)

		await fsp.chmod(paths.config, 0o644)
		await expect(rclone.hasCanonicalConfig(ACCOUNT_ID, 'webdav')).resolves.toBe(false)
	})

	test('lets rclone refresh a Dropbox token before direct API use', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		await fsp.writeFile(paths.config, '[cloud]\ntype = dropbox\n', {mode: 0o600})

		await rclone.refreshOAuthToken(ACCOUNT_ID, 'dropbox')

		const args = JSON.parse(await fsp.readFile(`${paths.config}.args`, 'utf8')) as string[]
		expect(args.slice(0, 3)).toEqual(['about', 'cloud:', '--json'])
	})

	test('bounds an unresponsive config control request', async () => {
		const transaction = await rclone.beginConfigTransaction(ACCOUNT_ID)
		vi.useFakeTimers()
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
			const controller = new AbortController()
			setTimeout(() => controller.abort(), milliseconds)
			return controller.signal
		})
		try {
			const rejection = expect(transaction.call('config/create', {hang: true})).rejects.toThrow(
				'[cloud-config-session-control-timeout]',
			)
			await vi.advanceTimersByTimeAsync(30_000)
			await rejection
			expect(timeout).toHaveBeenCalledWith(30_000)
		} finally {
			timeout.mockRestore()
			vi.useRealTimers()
			await transaction.abort()
		}
	})

	test('stops rclone with SIGINT so it can run graceful cleanup', async () => {
		const transaction = await rclone.beginConfigTransaction(ACCOUNT_ID)
		const signalPath = `${transaction.configPath}.signal`
		await transaction.abort()
		expect(await fsp.readFile(signalPath, 'utf8')).toBe('SIGINT')
	})

	test('writes the junk filter only when stale and never follows a symlink', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		const oldTime = new Date(1000)
		await fsp.utimes(paths.filter, oldTime, oldTime)

		await rclone.ensureAccountDirectory(ACCOUNT_ID)
		expect((await fsp.stat(paths.filter)).mtimeMs).toBe(1000)

		await fsp.writeFile(paths.filter, 'stale')
		await fsp.utimes(paths.filter, oldTime, oldTime)
		await rclone.ensureAccountDirectory(ACCOUNT_ID)
		expect(await fsp.readFile(paths.filter, 'utf8')).toBe(CLOUD_JUNK_FILTER)
		expect((await fsp.stat(paths.filter)).mtimeMs).toBeGreaterThan(1000)

		const target = `${dataDirectory}/filter-target`
		await fsp.writeFile(target, 'do not replace')
		await fsp.rm(paths.filter)
		await fsp.symlink(target, paths.filter)
		await expect(rclone.ensureAccountDirectory(ACCOUNT_ID)).rejects.toThrow()
		expect(await fsp.readFile(target, 'utf8')).toBe('do not replace')
	})

	test('removes only abandoned temporary configs without following symlinks', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		const staleConfig = `${paths.directory}/rclone-22222222-2222-4222-8222-222222222222.tmp`
		const unrelatedTempFile = `${paths.directory}/provider.tmp`
		const target = `${dataDirectory}/credential-target`
		const staleSymlink = `${paths.directory}/rclone-33333333-3333-4333-8333-333333333333.tmp`
		await fsp.writeFile(staleConfig, 'stale credential')
		await fsp.writeFile(unrelatedTempFile, 'keep')
		await fsp.writeFile(target, 'do not remove')
		await fsp.symlink(target, staleSymlink)

		await rclone.removeTemporaryConfigFiles(ACCOUNT_ID)

		await expect(fsp.access(staleConfig)).rejects.toThrow()
		await expect(fsp.access(staleSymlink)).rejects.toThrow()
		expect(await fsp.readFile(unrelatedTempFile, 'utf8')).toBe('keep')
		expect(await fsp.readFile(target, 'utf8')).toBe('do not remove')
	})

	test('rejects a temporary-config symlink without changing its target permissions', async () => {
		const paths = await rclone.ensureAccountDirectory(ACCOUNT_ID)
		const target = `${dataDirectory}/outside-config`
		const temporaryConfig = `${paths.directory}/rclone-22222222-2222-4222-8222-222222222222.tmp`
		await fsp.writeFile(target, '[cloud]\ntype = webdav\n', {mode: 0o644})
		await fsp.symlink(target, temporaryConfig)

		await expect(rclone.prepareTemporaryConfig(ACCOUNT_ID, temporaryConfig)).rejects.toThrow()

		expect((await fsp.stat(target)).mode & 0o777).toBe(0o644)
		expect(await fsp.readFile(target, 'utf8')).toBe('[cloud]\ntype = webdav\n')
	})
})
