import {mkdtemp} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {afterEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import App, {normalizeAppMountTargetPath, normalizeAppStorageSourcePath} from './app.js'
import type {AppManifest} from './schema.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fse.remove(directory)))
	vi.restoreAllMocks()
})

async function createApp() {
	const dataDirectory = await mkdtemp(path.join(tmpdir(), 'umbreld-app-settings-'))
	temporaryDirectories.push(dataDirectory)
	const instances: App[] = []
	const umbreld = {
		dataDirectory,
		logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		eventBus: {emit: vi.fn(async () => undefined)},
		apps: {
			instances,
			getDataRootPathsForApps: vi.fn(async () => []),
			getDataRootPathRelation: vi.fn(() => null),
			setFolderAccessSourcePaths: vi.fn(),
		},
		files: {
			virtualToSystemPath: vi.fn(async (virtualPath: string) => path.join(dataDirectory, virtualPath)),
			virtualToSystemPathUnsafe: vi.fn((virtualPath: string) => path.join(dataDirectory, virtualPath)),
		},
		lanIngress: {refresh: vi.fn(async () => undefined)},
	} as unknown as Umbreld

	async function addApp(id: string, manifest: Partial<AppManifest>) {
		const app = new App(umbreld, id)
		await fse.ensureDir(app.dataDirectory)
		await Promise.all([
			fse.writeFile(path.join(app.dataDirectory, 'umbrel-app.yml'), yaml.dump({manifestVersion: '1.0.0', ...manifest})),
			app.writeCompose({services: {app_proxy: {image: 'example/proxy'}, server: {image: 'example/server'}}}),
		])
		app.state = 'ready'
		instances.push(app)
		return app
	}

	const app = await addApp('test-app', {
		dependencies: ['bitcoin'],
		environment: [{name: 'MODE', services: ['server'], options: ['fast', 'full']}],
	})
	const restart = vi.spyOn(app, 'restart').mockResolvedValue(true)
	return {app, addApp, instances, restart, umbreld}
}

describe('app settings', () => {
	test('preserves space-suffixed folder and mount names through saving and Compose generation', async () => {
		const {app, umbreld} = await createApp()
		const source = path.join(umbreld.dataDirectory, 'Home', 'Shared ')
		await fse.ensureDir(source)
		Object.assign(umbreld, {
			files: {
				virtualToSystemPath: async (virtualPath: string) => path.join(umbreld.dataDirectory, virtualPath),
				virtualToSystemPathUnsafe: (virtualPath: string) => path.join(umbreld.dataDirectory, virtualPath),
			},
			notifications: {clear: vi.fn(async () => undefined)},
		})
		Object.assign(umbreld.apps, {
			beginStorageOperation: () => () => {},
			getDataRootPathRelation: () => null,
		})

		await expect(
			app.setSettings({
				customMounts: [{serviceName: 'server', sourcePath: '/Home/Shared /.', targetPath: '/media /.', readOnly: true}],
			}),
		).resolves.toBe(true)
		await expect(app.getCustomMounts()).resolves.toEqual([
			{serviceName: 'server', sourcePath: '/Home/Shared ', targetPath: '/media ', readOnly: true},
		])
		const generated = yaml.load(await fse.readFile(app.userSettingsComposePath, 'utf8'))
		expect(generated).toMatchObject({
			services: {server: {volumes: [{source, target: '/media ', read_only: true}]}},
		})
	})

	test('auth and credential preferences remain editable when a saved folder is unavailable', async () => {
		const {app, restart} = await createApp()
		const mount = {serviceName: 'server', sourcePath: '/External/Offline/Media', targetPath: '/media', readOnly: true}
		await app.store.set('customMounts', [mount])
		await expect(app.regenerateUserSettingsCompose()).rejects.toThrow('[apps-settings-source-missing]')

		await expect(app.setSettings({hideCredentialsBeforeOpen: true, appProxyAuthEnabled: false})).resolves.toBe(true)
		await expect(app.store.get()).resolves.toMatchObject({
			customMounts: [mount],
			hideCredentialsBeforeOpen: true,
			appProxyAuthEnabled: false,
		})
		expect(restart).not.toHaveBeenCalled()
	})

	test('saves the credential preference without restarting and preserves it when omitted', async () => {
		const {app, restart, umbreld} = await createApp()
		await app.store.set('dependencies', {bitcoin: 'missing-provider'})

		await expect(app.setSettings({hideCredentialsBeforeOpen: true})).resolves.toBe(true)
		await expect(app.store.get('hideCredentialsBeforeOpen')).resolves.toBe(true)
		await expect(app.setSettings({appProxyAuthEnabled: false})).resolves.toBe(true)
		await expect(app.store.get()).resolves.toMatchObject({
			hideCredentialsBeforeOpen: true,
			appProxyAuthEnabled: false,
			dependencies: {bitcoin: 'missing-provider'},
		})

		await expect(app.setSettings({hideCredentialsBeforeOpen: false, appProxyAuthEnabled: null})).resolves.toBe(true)
		await expect(app.store.get('hideCredentialsBeforeOpen')).resolves.toBe(false)
		await expect(app.store.get('appProxyAuthEnabled')).resolves.toBeUndefined()
		expect(restart).not.toHaveBeenCalled()
		expect(umbreld.lanIngress.refresh).toHaveBeenCalledTimes(2)
	})

	test('saves preference, compatible dependency, and environment in one write and restart', async () => {
		const {app, addApp, restart} = await createApp()
		await addApp('bitcoin-knots', {implements: ['bitcoin']})
		const update = vi.spyOn(app.store, 'update')

		await expect(
			app.setSettings({
				hideCredentialsBeforeOpen: true,
				dependencies: {bitcoin: 'bitcoin-knots'},
				environment: [{name: 'MODE', value: 'fast'}],
				customEnvironment: [{serviceName: 'server', name: 'TOKEN', value: 'literal$value'}],
			}),
		).resolves.toBe(true)
		expect(update).toHaveBeenCalledOnce()
		expect(restart).toHaveBeenCalledOnce()
		await expect(app.store.get()).resolves.toMatchObject({
			hideCredentialsBeforeOpen: true,
			dependencies: {bitcoin: 'bitcoin-knots'},
			environment: [{name: 'MODE', value: 'fast'}],
			customEnvironment: [{serviceName: 'server', name: 'TOKEN', value: 'literal$value'}],
		})
		const generatedCompose = yaml.load(await fse.readFile(app.userSettingsComposePath, 'utf8'))
		expect(generatedCompose).toMatchObject({services: {server: {environment: {MODE: 'fast', TOKEN: 'literal$$value'}}}})
	})

	test.each(['undeclared', 'missing', 'incompatible', 'installing', 'uninstalling'])(
		'rejects a %s dependency before saving any settings',
		async (invalid) => {
			const {app, addApp, restart} = await createApp()
			const provider = await addApp('provider', {implements: invalid === 'incompatible' ? [] : ['bitcoin']})
			if (invalid === 'installing' || invalid === 'uninstalling') provider.state = invalid
			await app.store.set('hideCredentialsBeforeOpen', false)
			const before = await fse.readFile(app.store.filePath, 'utf8')
			const dependencies: Record<string, string> =
				invalid === 'undeclared'
					? {unknown: 'provider'}
					: {bitcoin: invalid === 'missing' ? 'missing-provider' : 'provider'}

			await expect(app.setSettings({hideCredentialsBeforeOpen: true, dependencies})).rejects.toThrow(
				'[apps-settings-dependency-',
			)
			await expect(fse.readFile(app.store.filePath, 'utf8')).resolves.toBe(before)
			expect(restart).not.toHaveBeenCalled()
		},
	)

	test('allows unchanged stale dependency selections alongside a preference change', async () => {
		const {app, restart} = await createApp()
		await app.store.set('dependencies', {bitcoin: 'missing-provider'})

		await expect(
			app.setSettings({hideCredentialsBeforeOpen: true, dependencies: {bitcoin: 'missing-provider'}}),
		).resolves.toBe(true)
		await expect(app.store.get()).resolves.toMatchObject({
			hideCredentialsBeforeOpen: true,
			dependencies: {bitcoin: 'missing-provider'},
		})
		expect(restart).not.toHaveBeenCalled()
	})

	test('resetting dependency selections requires the canonical provider to be installed', async () => {
		const {app, addApp, restart} = await createApp()
		await app.store.set('dependencies', {bitcoin: 'missing-provider'})

		await expect(app.setSettings({dependencies: {}})).rejects.toThrow('[apps-settings-dependency-not-installed]')
		await expect(app.store.get('dependencies')).resolves.toEqual({bitcoin: 'missing-provider'})
		await addApp('bitcoin', {})
		await expect(app.setSettings({dependencies: {}})).resolves.toBe(true)
		await expect(app.store.get('dependencies')).resolves.toEqual({bitcoin: 'bitcoin'})
		expect(restart).toHaveBeenCalledOnce()
	})
})

describe('app storage source normalization', () => {
	test.each([
		['/Home/Shared ', '/Home/Shared '],
		['/Home/Shared /', '/Home/Shared '],
		['/Home/Shared /.', '/Home/Shared '],
		['/Home/Shared /x/..', '/Home/Shared '],
		['/Home/Shared/', '/Home/Shared'],
		['/External/My Drive/Movies/../Media', '/External/My Drive/Media'],
		['/Network/server/share//Movies', '/Network/server/share/Movies'],
	])('normalizes %j to the exact path used by app storage', (input, expected) => {
		expect(normalizeAppStorageSourcePath(input)).toBe(expected)
		expect(normalizeAppStorageSourcePath(normalizeAppStorageSourcePath(input))).toBe(expected)
	})

	test.each(['/Home/../../etc', '/External', '/Network/server', 'Home/Shared', ' /Home/Shared', '/Home/a\nb'])(
		'rejects an unsupported storage source %j',
		(input) => expect(() => normalizeAppStorageSourcePath(input)).toThrow('[apps-settings-'),
	)

	test.each(['/media ', '/media /', '/media /.', '/media /x/..'])(
		'preserves mount-target whitespace when normalizing %j repeatedly',
		(input) => {
			const normalized = normalizeAppMountTargetPath(input)
			expect(normalized).toBe('/media ')
			expect(normalizeAppMountTargetPath(normalized)).toBe(normalized)
		},
	)
})
