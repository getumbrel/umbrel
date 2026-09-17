import {mkdtemp} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import App, {readManifestInDirectory} from './app.js'
import Apps from './apps.js'
import appEnvironment from './legacy-compat/app-environment.js'
import type {AppManifest} from './schema.js'

vi.mock('./app.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./app.js')>()),
	readManifestInDirectory: vi.fn(),
}))

vi.mock('./legacy-compat/app-environment.js', () => ({default: vi.fn()}))

function createApps(umbrelVersion: string) {
	const assertAppPortAvailable = vi.fn()
	const resolveStorageDestination = vi.fn()
	const umbreld = {
		version: umbrelVersion,
		dataDirectory: '/tmp/manifest-compatibility-test',
		logger: {
			createChildLogger: () => ({log: vi.fn(), error: vi.fn()}),
		},
		appStore: {
			getAppTemplateFilePath: vi.fn(async () => '/app-template'),
		},
		files: {resolveStorageDestination},
		machines: {assertAppPortAvailable},
		eventBus: {emit: vi.fn()},
		lanIngress: {refresh: vi.fn(async () => {})},
	} as unknown as Umbreld

	const apps = new Apps(umbreld)
	umbreld.apps = apps
	return {apps, umbreld, assertAppPortAvailable, resolveStorageDestination}
}

beforeEach(() => {
	vi.mocked(readManifestInDirectory).mockReset()
	vi.mocked(appEnvironment).mockReset()
})

describe('manifest compatibility', () => {
	test('allows an update requiring the release version on an OS prerelease', async () => {
		const {apps} = createApps('2.0.0-beta.1')
		const update = vi.fn(async () => true)
		apps.instances = [{id: 'test-app', state: 'ready', update} as unknown as App]
		vi.mocked(readManifestInDirectory).mockResolvedValue({manifestVersion: '2.0.0'} as AppManifest)

		await expect(apps.update('test-app')).resolves.toBe(true)
		expect(update).toHaveBeenCalledOnce()
	})

	test('rejects an incompatible update before touching the installed app', async () => {
		const {apps} = createApps('1.9.9')
		const update = vi.fn(async () => true)
		const installedApp = {id: 'test-app', state: 'ready', stateProgress: 0, update} as unknown as App
		apps.instances = [installedApp]
		vi.mocked(readManifestInDirectory).mockResolvedValue({manifestVersion: '2.0.0'} as AppManifest)

		await expect(apps.update('test-app')).rejects.toThrow('App manifest version not supported')
		expect(update).not.toHaveBeenCalled()
		expect(installedApp).toMatchObject({state: 'ready', stateProgress: 0})
	})

	test('rejects an incompatible install before beginning installation', async () => {
		const {apps, assertAppPortAvailable} = createApps('1.9.9')
		vi.mocked(readManifestInDirectory).mockResolvedValue({manifestVersion: '2.0.0', port: 3000} as AppManifest)

		await expect(apps.install('test-app')).rejects.toThrow('App manifest version not supported')
		expect(assertAppPortAvailable).not.toHaveBeenCalled()
		expect(apps.instances).toStrictEqual([])
	})
})

describe('storage path reservations', () => {
	test('an operation that starts first blocks detaching its storage', async () => {
		const {apps} = createApps('2.0.0')
		apps.instances = [
			{id: 'test-app', state: 'stopped', readManifest: vi.fn(async () => ({name: 'Test App'}))} as unknown as App,
		]
		const releaseOperation = apps.beginStorageOperation('test-app', ['/External/Drive/Media'], {
			protectAsDataRoot: false,
		})

		try {
			await expect(apps.blockStoragePaths(['/External/Drive'])).rejects.toThrow('[storage-in-use-by-apps] Test App')
		} finally {
			releaseOperation()
		}
	})

	test('a detach that starts first blocks only overlapping operations', async () => {
		const {apps} = createApps('2.0.0')
		const releaseBlock = await apps.blockStoragePaths(['/External/Drive'])

		try {
			expect(() => apps.beginStorageOperation('blocked-app', ['/External/Drive/Media'])).toThrow(
				'[apps-storage-blocked]',
			)
			const releaseUnrelated = apps.beginStorageOperation('other-app', ['/External/Other/Media'])
			releaseUnrelated()
		} finally {
			releaseBlock()
		}
	})

	test('folder use blocks detach without becoming app-managed data', () => {
		const {apps} = createApps('2.0.0')
		const release = apps.beginStorageOperation('test-app', ['/External/Drive/Media'], {
			protectAsDataRoot: false,
		})

		try {
			expect(apps.getDataRootPathRelation('/External/Drive/Media')).toBeNull()
			expect(apps.hasActiveStoragePathOverlap('/External/Drive')).toBe(true)
		} finally {
			release()
		}
	})

	test('keeps active data-root ancestors distinct from the root and its descendants', () => {
		const {apps} = createApps('2.0.0')
		const release = apps.beginStorageOperation('test-app', ['/External/Drive/Apps/test-app'])

		try {
			expect(apps.getDataRootPathRelation('/External/Drive')).toBe('contains-active-root')
			expect(apps.getDataRootPathRelation('/External/Drive/Apps/test-app')).toBe('active-root')
			expect(apps.getDataRootPathRelation('/External/Drive/Apps/test-app/data')).toBe('inside-active-root')
		} finally {
			release()
		}
	})

	test('protects configured folder sources and their ancestors without protecting descendants or siblings', () => {
		const {apps} = createApps('2.0.0')
		apps.setFolderAccessSourcePaths('test-app', ['/Home/Media/Transmission'])

		expect(apps.getFolderAccessPathRelation('/Home/Media')).toBe('contains-folder-root')
		expect(apps.getFolderAccessPathRelation('/Home/Media/Transmission')).toBe('folder-root')
		expect(apps.getFolderAccessPathRelation('/Home/Media/Transmission/downloads')).toBe('inside-folder-root')
		expect(apps.getFolderAccessPathRelation('/Home/Media/Jellyfin')).toBeNull()

		apps.setFolderAccessSourcePaths('test-app', [])
		expect(apps.getFolderAccessPathRelation('/Home/Media/Transmission')).toBeNull()
	})

	test('reserves internal and external dependency data roots', async () => {
		const {apps} = createApps('2.0.0')
		apps.instances = [
			{id: 'internal-app', getDependencies: vi.fn(async () => [])} as unknown as App,
			{id: 'external-app', getDependencies: vi.fn(async () => [])} as unknown as App,
		]
		apps.setDataRootLocation('external-app', {
			path: '/External/Drive/Apps/external-app',
			filesystemUuid: 'drive',
		})

		await expect(apps.getDataRootPathsForApps(['internal-app', 'external-app'])).resolves.toStrictEqual([
			'/Apps/internal-app/data',
			'/External/Drive/Apps/external-app',
		])
	})
})

describe('install lifecycle', () => {
	test('rejects a second install of the same app without blocking other apps', async () => {
		const root = await fse.mkdtemp('/tmp/umbrel-duplicate-install-')
		const template = `${root}/template`
		await fse.ensureDir(template)
		const {apps, umbreld} = createApps('2.0.0')
		;(umbreld as any).dataDirectory = `${root}/data`
		;(umbreld.appStore.getAppTemplateFilePath as ReturnType<typeof vi.fn>).mockResolvedValue(template)
		vi.mocked(readManifestInDirectory).mockResolvedValue({
			manifestVersion: '1.0.0',
			port: 3000,
		} as AppManifest)

		let releaseEnvironment!: () => void
		const environmentHeld = new Promise<void>((resolve) => (releaseEnvironment = resolve))
		let signalEnvironmentEntered!: () => void
		const environmentEntered = new Promise<void>((resolve) => (signalEnvironmentEntered = resolve))
		vi.mocked(appEnvironment).mockImplementationOnce(async () => {
			signalEnvironmentEntered()
			await environmentHeld
			throw new Error('stop focused duplicate install test')
		})

		try {
			const first = apps.install('test-app')
			await environmentEntered
			await expect(apps.install('test-app')).rejects.toThrow('already being installed')
			releaseEnvironment()
			await expect(first).rejects.toThrow('stop focused duplicate install test')
		} finally {
			releaseEnvironment()
			await fse.remove(root)
		}
	})

	test('allows unrelated apps to install concurrently', async () => {
		const root = await fse.mkdtemp('/tmp/umbrel-concurrent-install-')
		const template = `${root}/template`
		await fse.ensureDir(template)
		const {apps, umbreld} = createApps('2.0.0')
		;(umbreld as any).dataDirectory = `${root}/data`
		;(umbreld.appStore.getAppTemplateFilePath as ReturnType<typeof vi.fn>).mockResolvedValue(template)
		vi.mocked(readManifestInDirectory).mockResolvedValue({
			manifestVersion: '1.0.0',
			port: 3000,
		} as AppManifest)

		let releaseInstalls!: () => void
		const installsHeld = new Promise<void>((resolve) => (releaseInstalls = resolve))
		let signalFirstEntered!: () => void
		let signalSecondEntered!: () => void
		const firstEntered = new Promise<void>((resolve) => (signalFirstEntered = resolve))
		const secondEntered = new Promise<void>((resolve) => (signalSecondEntered = resolve))
		let calls = 0
		vi.mocked(appEnvironment).mockImplementation(async () => {
			calls += 1
			if (calls === 1) signalFirstEntered()
			if (calls === 2) signalSecondEntered()
			await installsHeld
			throw new Error('stop focused concurrent install test')
		})

		try {
			const first = apps.install('first-app')
			await firstEntered
			const second = apps.install('second-app')
			await secondEntered
			expect(apps.instances.map((app) => app.id)).toEqual(['first-app', 'second-app'])
			releaseInstalls()
			await expect(Promise.all([first, second])).rejects.toThrow('stop focused concurrent install test')
		} finally {
			releaseInstalls()
			await fse.remove(root)
		}
	})

	test('claims the installing state before awaiting the app environment', async () => {
		const root = await fse.mkdtemp('/tmp/umbrel-install-state-')
		const template = `${root}/template`
		await fse.ensureDir(template)
		const {apps, umbreld} = createApps('2.0.0')
		;(umbreld as any).dataDirectory = `${root}/data`
		;(umbreld.appStore.getAppTemplateFilePath as ReturnType<typeof vi.fn>).mockResolvedValue(template)
		vi.mocked(readManifestInDirectory).mockResolvedValue({
			manifestVersion: '1.0.0',
			port: 3000,
		} as AppManifest)

		let releaseEnvironment!: () => void
		const environmentHeld = new Promise<void>((resolve) => (releaseEnvironment = resolve))
		let signalEnvironmentEntered!: () => void
		const environmentEntered = new Promise<void>((resolve) => (signalEnvironmentEntered = resolve))
		vi.mocked(appEnvironment).mockImplementationOnce(async () => {
			signalEnvironmentEntered()
			await environmentHeld
			throw new Error('stop focused install')
		})

		try {
			const install = apps.install('test-install')
			await environmentEntered
			expect(apps.instances[0]?.state).toBe('installing')
			await expect(apps.instances[0]?.setSettings({environment: []})).rejects.toThrow('while it is installing')
			releaseEnvironment()
			await expect(install).rejects.toThrow('stop focused install')
		} finally {
			releaseEnvironment()
			await fse.remove(root)
		}
	})
})

describe('app data root status', () => {
	test('distinguishes available storage, a missing data folder, and missing storage', async () => {
		const {apps, resolveStorageDestination} = createApps('2.0.0')

		resolveStorageDestination.mockResolvedValueOnce('/')
		await expect(
			apps.getDataRootStatus({path: '/External/Drive/My Apps/available', filesystemUuid: 'drive'}),
		).resolves.toBe('available')

		resolveStorageDestination.mockResolvedValueOnce('/tmp/umbrel-data-root-status-test-missing')
		await expect(
			apps.getDataRootStatus({path: '/External/Drive/My Apps/missing', filesystemUuid: 'drive'}),
		).resolves.toBe('data-missing')

		resolveStorageDestination.mockRejectedValueOnce(new Error('[cloud-destination-missing]'))
		await expect(
			apps.getDataRootStatus({path: '/External/Offline/My Apps/app', filesystemUuid: 'offline'}),
		).resolves.toBe('storage-unavailable')
	})
})

describe('storage eject accounting', () => {
	test('keeps saved folder paths when effective Compose resolution fails', async () => {
		const {apps} = createApps('2.0.0')
		apps.instances = [
			{
				id: 'test-app',
				state: 'ready',
				getDependencies: vi.fn(async () => []),
				getEffectiveFolderAccessSourcePaths: vi.fn(async () => {
					throw new Error('broken compose')
				}),
				getConfiguredFolderAccessSourcePaths: vi.fn(async () => ['/External/Drive/Media']),
				readManifest: vi.fn(async () => ({name: 'Test App'})),
			} as unknown as App,
		]

		await expect(apps.getAppsUsingStorageSource('/External/Drive')).resolves.toStrictEqual(['Test App'])
	})

	test('treats an app with unknown container state as potentially active', async () => {
		const {apps} = createApps('2.0.0')
		apps.instances = [
			{
				id: 'test-app',
				state: 'unknown',
				getDependencies: vi.fn(async () => []),
				getEffectiveFolderAccessSourcePaths: vi.fn(async () => ['/External/Drive/Media']),
				readManifest: vi.fn(async () => ({name: 'Test App'})),
			} as unknown as App,
		]

		await expect(apps.getAppsUsingStorageSource('/External/Drive')).resolves.toStrictEqual(['Test App'])
	})
})

describe('restored data root move journals', () => {
	test('drops journals after a backup restore but keeps the other settings', async () => {
		const dataDirectory = await mkdtemp(path.join(tmpdir(), 'umbreld-apps-restore-'))
		try {
			const settings = {
				'moved-app': {
					dataRootLocation: {path: '/External/Drive/moved-app', filesystemUuid: 'abcd-1234'},
					dataRootMove: {
						source: null,
						destination: {path: '/External/Drive/moved-app', filesystemUuid: 'abcd-1234'},
						token: '00000000-0000-4000-8000-000000000000',
					},
					dataRootResetPending: true,
				},
				'plain-app': {autoStart: true},
			}
			for (const [appId, appSettings] of Object.entries(settings)) {
				await fse.ensureDir(path.join(dataDirectory, 'app-data', appId))
				await fse.writeFile(path.join(dataDirectory, 'app-data', appId, 'settings.yml'), yaml.dump(appSettings))
			}

			const umbreld = {
				dataDirectory,
				logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
				store: {get: vi.fn(async () => Object.keys(settings))},
			} as unknown as Umbreld
			const apps = new Apps(umbreld)
			await apps.clearRestoredDataRootMoves()

			const movedApp = new App(umbreld, 'moved-app')
			await expect(movedApp.store.get('dataRootMove')).resolves.toBeUndefined()
			await expect(movedApp.store.get('dataRootLocation')).resolves.toStrictEqual({
				path: '/External/Drive/moved-app',
				filesystemUuid: 'abcd-1234',
			})
			await expect(movedApp.store.get('dataRootResetPending')).resolves.toBe(true)
			const plainApp = new App(umbreld, 'plain-app')
			await expect(plainApp.store.get('autoStart')).resolves.toBe(true)
		} finally {
			await fse.remove(dataDirectory)
		}
	})
})
