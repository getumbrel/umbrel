import {mkdtemp} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {afterEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import App from './app.js'
import appScript from './legacy-compat/app-script.js'

vi.mock('./legacy-compat/app-script.js', () => ({
	default: vi.fn(async () => ({stdout: ''})),
}))

vi.mock('../utilities/docker-pull.js', () => ({pullAll: vi.fn(async () => true)}))

vi.mock('execa', () => ({
	$: (optionsOrTemplate: unknown) => {
		const result = Promise.resolve({stdout: '', exitCode: 0})
		return Array.isArray(optionsOrTemplate) ? result : () => result
	},
}))

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fse.remove(directory)))
	vi.restoreAllMocks()
	vi.mocked(appScript)
		.mockReset()
		.mockResolvedValue({stdout: ''} as any)
})

async function createApp({
	apps = {},
	files = {},
	lanIngress = {},
}: {
	apps?: Record<string, unknown>
	files?: Record<string, unknown>
	lanIngress?: Record<string, unknown>
} = {}) {
	const dataDirectory = await mkdtemp(path.join(tmpdir(), 'umbreld-app-lifecycle-'))
	temporaryDirectories.push(dataDirectory)
	const appId = 'test-app'
	const appDataDirectory = path.join(dataDirectory, 'app-data', appId)
	await fse.ensureDir(appDataDirectory)
	await Promise.all([
		fse.writeFile(path.join(appDataDirectory, 'umbrel-app.yml'), yaml.dump({manifestVersion: '1.0.0'})),
		fse.writeFile(
			path.join(appDataDirectory, 'docker-compose.yml'),
			yaml.dump({services: {server: {image: 'example/test'}}}),
		),
	])

	const globalStore = {
		getWriteLock: vi.fn(async (job) =>
			job({
				get: vi.fn(async (key: string) => (key === 'apps' ? [appId] : [])),
				set: vi.fn(async () => true),
				delete: vi.fn(async () => true),
			}),
		),
	}
	const umbreld = {
		dataDirectory,
		logger: {
			createChildLogger: () => ({log: vi.fn(), error: vi.fn()}),
		},
		eventBus: {emit: vi.fn(async () => undefined)},
		apps: {
			getRuntimeDataRootContext: vi.fn(async () => ({
				dataRoots: {[appId]: path.join(appDataDirectory, 'data')},
				storagePaths: [],
			})),
			beginStorageOperation: vi.fn(() => vi.fn()),
			setDataRootLocation: vi.fn(),
			setFolderAccessSourcePaths: vi.fn(),
			isStorageSourceAvailable: vi.fn(async () => true),
			getDataRootPathRelation: vi.fn(() => null),
			hasActiveStoragePathOverlap: vi.fn(() => false),
			getAppsWithFolderAccessOverlap: vi.fn(async () => []),
			...apps,
		},
		files: {
			virtualToSystemPath: vi.fn(async (virtualPath: string) => path.join(dataDirectory, virtualPath)),
			normalizeVirtualPath: vi.fn((virtualPath: string) => virtualPath),
			getExternalStorageFilesystemType: vi.fn(async () => 'ext4'),
			...files,
		},
		lanIngress: {
			refresh: vi.fn(async () => undefined),
			waitForAppUpstream: vi.fn(async () => undefined),
			...lanIngress,
		},
		notifications: {add: vi.fn(async () => true), clear: vi.fn(async () => undefined)},
		store: globalStore,
	} as unknown as Umbreld

	const app = new App(umbreld, appId)
	app.state = 'ready'
	return app
}

function pauseMoveRecovery(app: App) {
	const originalGet = app.store.get.bind(app.store) as (property?: string) => Promise<unknown>
	let release!: () => void
	const held = new Promise<void>((resolve) => (release = resolve))
	let entered!: () => void
	const recoveryEntered = new Promise<void>((resolve) => (entered = resolve))
	let paused = false

	vi.spyOn(app.store, 'get').mockImplementation((async (property?: string) => {
		if (property === 'dataRootMove' && !paused) {
			paused = true
			entered()
			await held
		}
		return originalGet(property)
	}) as typeof app.store.get)

	return {recoveryEntered, release}
}

describe('app lifecycle serialization', () => {
	test.each([
		{action: 'start' as const, pendingState: 'starting'},
		{action: 'restart' as const, pendingState: 'restarting'},
	])('keeps an app $pendingState until its upstream is reachable', async ({action, pendingState}) => {
		let markUpstreamReady = () => {}
		const upstreamReady = new Promise<void>((resolve) => (markUpstreamReady = resolve))
		let upstreamIsReady = false
		const waitForAppUpstream = vi.fn(async () => {
			await upstreamReady
			upstreamIsReady = true
		})
		let app!: App
		let refreshedBeforeReady = false
		const refresh = vi.fn(async () => {
			if (upstreamIsReady && !refreshedBeforeReady) {
				refreshedBeforeReady = true
				expect(app.state).toBe(pendingState)
			}
		})
		app = await createApp({lanIngress: {refresh, waitForAppUpstream}})

		const operation = app[action]()
		await vi.waitFor(() => expect(waitForAppUpstream).toHaveBeenCalledWith('test-app'))
		expect(app.state).toBe(pendingState)

		markUpstreamReady()
		await expect(operation).resolves.toBe(true)
		expect(refreshedBeforeReady).toBe(true)
		expect(app.state).toBe('ready')
	})

	test('keeps app data writable while lifecycle scripts reserve its storage', async () => {
		const beginStorageOperation = vi.fn(() => vi.fn())
		const app = await createApp({apps: {beginStorageOperation}})

		await expect(app.stop()).resolves.toBe(true)
		expect(beginStorageOperation).toHaveBeenCalledWith('test-app', [], {protectAsDataRoot: false})
	})

	test('blocks settings as soon as an update begins', async () => {
		const app = await createApp()
		const {recoveryEntered, release} = pauseMoveRecovery(app)
		let failNextComposeRead = false
		const originalReadCompose = app.readCompose.bind(app)
		vi.spyOn(app, 'readCompose').mockImplementation(async () => {
			if (failNextComposeRead) {
				failNextComposeRead = false
				throw new Error('stop focused update test')
			}
			return originalReadCompose()
		})

		const update = app.update()
		await recoveryEntered
		try {
			await expect(app.setSettings({environment: []})).rejects.toThrow('while it is updating')
		} finally {
			failNextComposeRead = true
			release()
			await update.catch(() => undefined)
		}
	})

	test('blocks settings as soon as an uninstall begins', async () => {
		const app = await createApp()
		const {recoveryEntered, release} = pauseMoveRecovery(app)

		const uninstall = app.uninstall()
		await recoveryEntered
		try {
			await expect(app.setSettings({environment: []})).rejects.toThrow('while it is uninstalling')
		} finally {
			release()
			await expect(uninstall).resolves.toBe(true)
		}
	})
})

describe('storage settings after an app update', () => {
	test('forgets a custom mount whose service was removed', async () => {
		const app = await createApp()
		const customMount = {
			serviceName: 'retired',
			targetPath: '/media',
			sourcePath: '/Home/Media',
			readOnly: false,
		}
		await app.writeCompose({services: {retired: {}}})
		await app.store.set('customMounts', [customMount])
		vi.mocked(appScript).mockImplementation(async (_umbreld, command) => {
			if (command === 'pre-patch-update') await app.writeCompose({services: {server: {}}})
			return {stdout: ''} as any
		})

		await expect(app.update()).resolves.toBe(true)
		await expect(app.store.get('customMounts')).resolves.toBeUndefined()
	})

	test('finishes pending fresh-data initialization while updating', async () => {
		const app = await createApp()
		await app.store.set('dataRootResetPending', true)
		const commands: string[] = []
		vi.mocked(appScript).mockImplementation(async (_umbreld, command) => {
			commands.push(command)
			return {stdout: ''} as any
		})

		await expect(app.update()).resolves.toBe(true)
		expect(commands).toContain('initialize-data-root')
		await expect(app.store.get('dataRootResetPending')).resolves.toBeUndefined()
	})
})

describe('data root moves and journal recovery', () => {
	async function createAppWithDataRootSupport(overrides: Parameters<typeof createApp>[0] = {}) {
		const app = await createApp(overrides)
		await fse.writeFile(
			path.join(app.dataDirectory, 'umbrel-app.yml'),
			yaml.dump({manifestVersion: '1.0.0', storage: {dataRoot: 'data'}}),
		)
		return app
	}

	test('does not reserve storage for a no-op move', async () => {
		const beginStorageOperation = vi.fn(() => vi.fn())
		const app = await createAppWithDataRootSupport({apps: {beginStorageOperation}})

		await expect(app.moveDataRoot(null)).resolves.toBe(true)
		expect(beginStorageOperation).not.toHaveBeenCalled()
	})

	test('rejects moving app data to network storage', async () => {
		const getStorageDestination = vi.fn()
		const app = await createAppWithDataRootSupport({files: {getStorageDestination}})

		await expect(app.moveDataRoot('/Network/nas/media')).rejects.toThrow(
			'[apps-data-root-invalid-location] Choose a folder on an external drive',
		)
		expect(getStorageDestination).not.toHaveBeenCalled()
	})

	test('rejects moving app data to a non-ext4 external drive', async () => {
		const destinationParentPath = '/External/Drive/App Data'
		const destinationPath = `${destinationParentPath}/test-app`
		const beginStorageOperation = vi.fn(() => vi.fn())
		const getExternalStorageFilesystemType = vi.fn(async () => 'exfat')
		const app = await createAppWithDataRootSupport({
			apps: {beginStorageOperation},
			files: {
				getStorageDestination: vi.fn(async () => ({path: destinationPath, filesystemUuid: 'drive'})),
				getExternalStorageFilesystemType,
			},
		})

		await expect(app.moveDataRoot(destinationParentPath)).rejects.toThrow(
			'[apps-data-root-unsupported-filesystem] App storage can only be moved to an ext4 drive',
		)
		expect(getExternalStorageFilesystemType).toHaveBeenCalledWith('drive')
		expect(beginStorageOperation).not.toHaveBeenCalled()
	})

	test('sees folder settings reserved while the destination resolves', async () => {
		const destinationParentPath = '/External/Drive/App Data'
		const destinationPath = `${destinationParentPath}/test-app`
		let releaseDestination!: () => void
		const destinationHeld = new Promise<void>((resolve) => (releaseDestination = resolve))
		let signalDestinationEntered!: () => void
		const destinationEntered = new Promise<void>((resolve) => (signalDestinationEntered = resolve))
		let folderSettingsReserved = false
		const beginStorageOperation = vi.fn(() => vi.fn())
		const app = await createAppWithDataRootSupport({
			apps: {
				beginStorageOperation,
				hasActiveStoragePathOverlap: vi.fn((path: string) => folderSettingsReserved && path === destinationPath),
			},
			files: {
				getStorageDestination: vi.fn(async () => {
					signalDestinationEntered()
					await destinationHeld
					return {path: destinationPath, filesystemUuid: 'drive'}
				}),
			},
		})

		const move = app.moveDataRoot(destinationParentPath)
		await destinationEntered
		folderSettingsReserved = true
		releaseDestination()

		await expect(move).rejects.toThrow('apps-data-root-folder-access-overlap')
		expect(beginStorageOperation).not.toHaveBeenCalled()
	})

	test('abandons a journal that matches neither storage location', async () => {
		const app = await createAppWithDataRootSupport()
		await app.store.set('dataRootMove', {
			source: {path: '/External/DriveA/test-app'},
			destination: {path: '/External/DriveB/test-app'},
			token: '00000000-0000-4000-8000-000000000000',
		})

		// A wedged journal used to fail this with [apps-data-root-recovery-needed]
		// with no way out for an app on internal storage
		await expect(app.moveDataRoot(null)).resolves.toBe(true)
		await expect(app.store.get('dataRootMove')).resolves.toBeUndefined()
	})

	test('abandons a journal that fails validation', async () => {
		const app = await createAppWithDataRootSupport()
		await app.store.set('dataRootMove', {bogus: true} as any)

		await expect(app.moveDataRoot(null)).resolves.toBe(true)
		await expect(app.store.get('dataRootMove')).resolves.toBeUndefined()
	})
})
