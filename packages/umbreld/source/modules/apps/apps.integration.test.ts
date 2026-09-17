import {setTimeout} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {expect, beforeAll, afterAll, test, vi} from 'vitest'
import {$} from 'execa'
import fse from 'fs-extra'
import getPort from 'get-port'
import yaml from 'js-yaml'
import pRetry from 'p-retry'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'
import {BACKUP_RESTORE_FIRST_START_FLAG} from '../../constants.js'
import {OWNER_ACCOUNT_ID} from '../auth/auth.js'
import runGitServer from '../test-utilities/run-git-server.js'
import App from './app.js'
import type {AppManifest} from './schema.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
let communityAppStoreGitServer: Awaited<ReturnType<typeof runGitServer>>
let stopAppAuthUi = async () => {}

beforeAll(async () => {
	stopAppAuthUi = await startAppAuthUi()
	;[umbreld, communityAppStoreGitServer] = await Promise.all([createTestUmbreld(), runGitServer()])
})

afterAll(async () => {
	await Promise.all([communityAppStoreGitServer.close(), umbreld.cleanup(), stopAppAuthUi()])
})

// The following tests are stateful and must be run in order

test.sequential('list() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.list.query()).rejects.toThrow('Invalid token')
})

test.sequential('install() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test.sequential('installReview() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.installReview.query({appId: 'sparkles-hello-world'})).rejects.toThrow(
		'Invalid token',
	)
})

test.sequential('state() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.state.query({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test.sequential('restart() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.restart.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test.sequential('update() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test.sequential('updates() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.updates.query()).rejects.toThrow('Invalid token')
})

test.sequential('trackOpen() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.trackOpen.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test.sequential('trackOpen() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.setTorEnabled.mutate(true)).rejects.toThrow('Invalid token')
})

test.sequential('getBackupIgnoredPaths() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.getBackupIgnoredPaths.query({appId: 'sparkles-hello-world'})).rejects.toThrow(
		'Invalid token',
	)
})

test.sequential('login', async () => {
	await expect(umbreld.registerAndLogin()).resolves.toBe(true)
})

test.sequential('list() returns no apps when none are installed', async () => {
	const installedApps = await umbreld.client.apps.list.query()
	expect(installedApps.length).toStrictEqual(0)
})

test.sequential('install() throws error on unknown app id', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'unknown-app-id'})).rejects.toThrow('not found')
})

test.sequential('install() throws error on invalid app id', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'invalid-id-@/!'})).rejects.toThrow('Invalid')
})

test.sequential('restart() throws error on unknown app id', async () => {
	await expect(umbreld.client.apps.restart.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('not found')
})

test.sequential('update() throws error on unknown app id', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('not found')
})

test.sequential('trackOpen() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.trackOpen.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('not found')
})

test.sequential('getBackupIgnoredPaths() throws error on unknown app id', async () => {
	await expect(umbreld.client.apps.getBackupIgnoredPaths.query({appId: 'sparkles-hello-world'})).rejects.toThrow(
		'not found',
	)
})

test.sequential('install() applies reviewed folder access before the app starts', async () => {
	const appId = 'sparkles-hello-world'
	const templatePath = await umbreld.instance.appStore.getAppTemplateFilePath(appId)
	const composePath = path.join(templatePath, 'docker-compose.yml')
	const manifestPath = path.join(templatePath, 'umbrel-app.yml')
	const originalCompose = await fse.readFile(composePath, 'utf8')
	const originalManifest = await fse.readFile(manifestPath, 'utf8')
	const selectedVirtualPath = '/Home/Install Review Downloads'
	const selectedSystemPath = path.join(umbreld.instance.dataDirectory, 'home', 'Install Review Downloads')

	try {
		const compose = yaml.load(originalCompose) as Record<string, any>
		compose.services.server.volumes = ['${UMBREL_ROOT}/data/storage/incoming:/downloads']
		await fse.writeFile(composePath, yaml.dump(compose))

		const manifest = yaml.load(originalManifest) as AppManifest
		manifest.permissions = [...(manifest.permissions ?? []), 'GPU']
		manifest.folderAccess = [
			{
				id: 'downloads',
				name: 'Downloads',
				note: 'This folder stores downloaded files.',
				mounts: [{service: 'server', targetPath: '/downloads'}],
			},
		]
		await fse.writeFile(manifestPath, yaml.dump(manifest))

		await expect(umbreld.client.apps.installReview.query({appId})).resolves.toStrictEqual({
			requiredFolders: [
				{
					id: 'downloads',
					name: 'Downloads',
					note: 'This folder stores downloaded files.',
					defaultSourcePath: '/Home/incoming',
					readOnly: false,
				},
			],
			gpuAccess: true,
		})

		await fse.ensureDir(selectedSystemPath)
		await expect(
			umbreld.client.apps.install.mutate({
				appId,
				folderAccess: [{id: 'downloads', sourcePath: selectedVirtualPath}],
			}),
		).resolves.toStrictEqual(true)
	} finally {
		await Promise.all([fse.writeFile(composePath, originalCompose), fse.writeFile(manifestPath, originalManifest)])
	}

	const installedPath = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const settings = yaml.load(await fse.readFile(path.join(installedPath, 'settings.yml'), 'utf8')) as Record<
		string,
		any
	>
	expect(settings.folderAccess).toStrictEqual([{id: 'downloads', sourcePath: selectedVirtualPath}])
	const userSettingsCompose = yaml.load(
		await fse.readFile(path.join(installedPath, 'docker-compose.umbrel-user-settings.yml'), 'utf8'),
	) as Record<string, any>
	expect(userSettingsCompose.services.server.volumes).toContainEqual(
		expect.objectContaining({source: selectedSystemPath, target: '/downloads'}),
	)
})

test.sequential('state() shows app install state', async () => {
	await expect(umbreld.client.apps.state.query({appId: 'sparkles-hello-world'})).resolves.toSatisfy((value) =>
		['installing', 'ready'].includes((value as any).state),
	)
	// TODO: Test this more extensively once we've implemented the behaviour
})

test.sequential('state() becomes ready once install completes', async () => {
	let lastState: any
	do {
		lastState = await umbreld.client.apps.state.query({appId: 'sparkles-hello-world'})
		if (lastState && lastState.state === 'ready') break
		await setTimeout(1000)
	} while (true)
	await expect(lastState).toMatchObject({state: 'ready'})
})

test.sequential('updates() lists nothing when installed apps match the registry', async () => {
	await expect(umbreld.client.apps.updates.query()).resolves.toStrictEqual([])
})

test.sequential('updates() lists an app whose installed version differs from the registry', async () => {
	// Rewrite the installed manifest to an older version; the registry still
	// serves the version the app was installed at
	const manifestPath = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world', 'umbrel-app.yml')
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	const registryVersion = manifest.version
	manifest.version = '0.0.1'
	await fse.writeFile(manifestPath, yaml.dump(manifest))

	await expect(umbreld.client.apps.updates.query()).resolves.toStrictEqual([
		{id: 'sparkles-hello-world', version: registryVersion},
	])

	// Restore the real version so later tests aren't affected
	manifest.version = registryVersion
	await fse.writeFile(manifestPath, yaml.dump(manifest))
})

test.sequential('updates() skips registry apps with non-string versions', async () => {
	const appPath = await umbreld.instance.appStore.getAppTemplateFilePath('sparkles-hello-world')
	const manifestPath = path.join(appPath, 'umbrel-app.yml')
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	const registryVersion = manifest.version
	manifest.version = 1.2 as unknown as string
	await fse.writeFile(manifestPath, yaml.dump(manifest))

	try {
		await expect(umbreld.client.apps.updates.query()).resolves.toStrictEqual([])
	} finally {
		manifest.version = registryVersion
		await fse.writeFile(manifestPath, yaml.dump(manifest))
	}
})

test.sequential('updates() follows the same first-repository precedence as app updates', async () => {
	const manifestPath = path.join(communityAppStoreGitServer.directory, 'sparkles-hello-world', 'umbrel-app.yml')
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	manifest.version = '9.9.9'
	await fse.writeFile(manifestPath, yaml.dump(manifest))
	const git = $({cwd: communityAppStoreGitServer.directory})
	await git`git add sparkles-hello-world/umbrel-app.yml`
	await git`git commit -m ${'Change app version'}`

	await umbreld.client.appStore.addRepository.mutate({url: communityAppStoreGitServer.url})
	try {
		// The installed app and first repository are both at 1.0.0. The second
		// repository must not override the version that apps.update will install.
		await expect(umbreld.client.apps.updates.query()).resolves.toStrictEqual([])
	} finally {
		await umbreld.client.appStore.removeRepository.mutate({url: communityAppStoreGitServer.url})
	}
})

test.sequential('app auth dev proxy serves executable UI modules with scoped handoff CSP', async () => {
	const document = await umbreld.unauthenticatedApi.get('../app-auth/?origin=host&app=sparkles-hello-world&path=%2F', {
		responseType: 'text',
	})
	expect(document.headers['content-type']).toMatch(/^text\/html/)
	expect(document.headers['content-security-policy']).toContain("form-action 'self' http://127.0.0.1:*")

	const scripts = [...document.body.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1])
	expect(scripts.length).toBeGreaterThan(0)
	expect(scripts).toContain('/src/app-auth.tsx')
	expect(scripts).not.toContain('/src/dashboard.tsx')
	for (const source of scripts) {
		const url = new URL(source, 'http://umbrel.local')
		const module = await umbreld.unauthenticatedApi.get(`../app-auth${url.pathname}${url.search}`, {
			responseType: 'text',
		})
		expect(module.statusCode, source).toBe(200)
		expect(module.headers['content-type'], source).toMatch(/javascript/)
		expect(module.body, source).not.toMatch(/^\s*<!doctype html>/i)
	}

	const hiddenService = `${'a'.repeat(56)}.onion`
	const hiddenServicePath = path.join(umbreld.instance.dataDirectory, 'tor/data/app-sparkles-hello-world/hostname')
	await fse.outputFile(hiddenServicePath, hiddenService)
	try {
		const torDocument = await umbreld.unauthenticatedApi.get(
			'../app-auth/?origin=tor&app=sparkles-hello-world&path=%2F',
			{responseType: 'text'},
		)
		expect(torDocument.headers['content-security-policy']).toContain(`form-action 'self' http://${hiddenService}`)
		expect(torDocument.headers['content-security-policy']).not.toContain(`${hiddenService}:*`)
	} finally {
		await fse.remove(hiddenServicePath)
	}
})

test.sequential('runs app proxying in umbreld without an app-proxy container', async () => {
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world')
	const originalCompose = yaml.load(
		await fse.readFile(path.join(appDataDirectory, 'docker-compose.yml'), 'utf8'),
	) as any
	const runtimeCompose = yaml.load(
		await fse.readFile(path.join(appDataDirectory, 'docker-compose.umbreld.yml'), 'utf8'),
	) as any
	const gatewayConfig = await fse.readJson(path.join(appDataDirectory, 'app-gateway.json'))

	expect(originalCompose.services.app_proxy).toBeDefined()
	expect(originalCompose.services.app_proxy.environment).toEqual({
		APP_HOST: '$APP_SPARKLES_HELLO_WORLD_HOST',
		APP_PORT: '$APP_SPARKLES_HELLO_WORLD_PORT',
	})
	expect(gatewayConfig).toMatchObject({
		APP_HOST: 'sparkles-hello-world_server_1',
		APP_PORT: '3000',
	})
	expect(runtimeCompose.services.app_proxy).toBeUndefined()
	await expect(umbreld.instance.apps.getApp('sparkles-hello-world').getContainerNames()).resolves.not.toContain(
		'sparkles-hello-world_app_proxy_1',
	)
})

test.sequential('app auth exchanges its cookie for an app-bound one-time handoff', async () => {
	const login = await umbreld.unauthenticatedApi.post('../trpc/user.login', {json: {password: 'moneyprintergobrrr'}})
	const appSession = (login.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_APP_SESSION='))
		?.split(';')[0]
	expect(appSession).toBeDefined()

	const handoff = await umbreld.unauthenticatedApi
		.get('../app-auth/v1/account/session?origin=host&app=sparkles-hello-world&path=%2Fsettings%3Ftab%3Dnetwork', {
			headers: {cookie: appSession!},
		})
		.json<{url: string; params: {r: string; handoff: string}}>()
	expect(handoff.url).toMatch(/^http:\/\/127\.0\.0\.1:4000\/umbrel_\/api\/v1\/auth\/handoff$/)
	expect(handoff.params.r).toBe('/settings?tab=network')
	expect(handoff.params).not.toHaveProperty('token')

	await expect(
		umbreld.instance.auth.consumeAppHandoff('sparkles-hello-world', handoff.params.handoff),
	).resolves.toMatchObject({principal: {accountId: OWNER_ACCOUNT_ID}})
	await expect(umbreld.instance.auth.consumeAppHandoff('sparkles-hello-world', handoff.params.handoff)).rejects.toThrow(
		'Invalid app handoff',
	)
})

test.sequential('list() lists installed apps', async () => {
	await expect(umbreld.client.apps.list.query()).resolves.toMatchObject([
		{
			id: 'sparkles-hello-world',
			name: 'Hello World',
			icon: 'https://svgur.com/i/mvA.svg',
			port: 4000,
			credentials: {
				defaultUsername: '',
				defaultPassword: '',
			},
			dependencies: [],
			hiddenService: '',
			path: '',
			state: 'ready',
			version: '1.0.0',
		},
	])
})

test.sequential('list() reports when an app requires HTTPS', async () => {
	const manifestPath = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world', 'umbrel-app.yml')
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	manifest.requiresHttps = true
	await fse.writeFile(manifestPath, yaml.dump(manifest))

	try {
		const apps = await umbreld.client.apps.list.query()
		expect(apps.find((app: any) => app.id === 'sparkles-hello-world')).toMatchObject({requiresHttps: true})
	} finally {
		delete manifest.requiresHttps
		await fse.writeFile(manifestPath, yaml.dump(manifest))
	}
})

test.sequential('setSettings() overrides and resets app proxy authentication', async () => {
	const appId = 'sparkles-hello-world'
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const settingsPath = path.join(appDataDirectory, 'settings.yml')
	const userSettingsComposePath = path.join(appDataDirectory, 'docker-compose.umbrel-user-settings.yml')
	const userSettingsComposeBefore = await fse.readFile(userSettingsComposePath, 'utf8')
	const getAppProxyAuth = async () => {
		const app = (await umbreld.client.apps.list.query()).find((app) => app.id === appId)
		if (!app || 'error' in app) throw new Error(`Failed to read installed app ${appId}`)
		return app.appProxyAuth
	}

	await expect(getAppProxyAuth()).resolves.toStrictEqual({
		supported: true,
		defaultEnabled: true,
		override: null,
		enabled: true,
	})

	// Auth lives in umbreld's app gateway which reads the override from the
	// settings store, so an auth-only change applies without a restart and
	// doesn't change the generated compose contents
	const app = umbreld.instance.apps.getApp(appId)
	const restartSpy = vi.spyOn(app, 'restart')
	const settingsChanged = umbreld.instance.eventBus.once('apps:settings:change')
	await expect(umbreld.client.apps.setSettings.mutate({appId, appProxyAuthEnabled: false})).resolves.toStrictEqual(true)
	await expect(settingsChanged).resolves.toStrictEqual({appId})
	expect(restartSpy).not.toHaveBeenCalled()
	await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'ready'})

	await expect(fse.readFile(userSettingsComposePath, 'utf8')).resolves.toBe(userSettingsComposeBefore)
	const settings = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settings.appProxyAuthEnabled).toBe(false)

	await expect(getAppProxyAuth()).resolves.toStrictEqual({
		supported: true,
		defaultEnabled: true,
		override: false,
		enabled: false,
	})

	await expect(umbreld.client.apps.setSettings.mutate({appId, appProxyAuthEnabled: null})).resolves.toStrictEqual(true)
	expect(restartSpy).not.toHaveBeenCalled()
	restartSpy.mockRestore()

	const settingsAfterReset = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settingsAfterReset).not.toHaveProperty('appProxyAuthEnabled')
	await expect(getAppProxyAuth()).resolves.toStrictEqual({
		supported: true,
		defaultEnabled: true,
		override: null,
		enabled: true,
	})
})

test.sequential('setSettings() configures suggested folders and advanced mount overrides', async () => {
	const appId = 'sparkles-hello-world'
	const installedApp = umbreld.instance.apps.getApp(appId)
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const composePath = path.join(appDataDirectory, 'docker-compose.yml')
	const manifestPath = path.join(appDataDirectory, 'umbrel-app.yml')
	const settingsPath = path.join(appDataDirectory, 'settings.yml')
	const userSettingsComposePath = path.join(appDataDirectory, 'docker-compose.umbrel-user-settings.yml')
	const mediaSourcePath = path.join(umbreld.instance.dataDirectory, 'home', 'Media Library')
	const musicSourcePath = path.join(umbreld.instance.dataDirectory, 'home', 'Music Library')
	const originalComposeContents = await fse.readFile(composePath, 'utf8')
	const originalManifestContents = await fse.readFile(manifestPath, 'utf8')
	const getStorageSettings = async () => {
		const app = (await umbreld.client.apps.list.query()).find((app) => app.id === appId)
		if (!app || 'error' in app) throw new Error(`Failed to read installed app ${appId}`)
		return app.storage
	}
	const waitForReady = async (description: string) => {
		for (let i = 0; i < 60; i++) {
			const state = await umbreld.client.apps.state.query({appId})
			if (state.state === 'ready') return
			await setTimeout(1000)
		}
		throw new Error(`${appId} did not return to ready state after ${description}`)
	}

	await expect(getStorageSettings()).resolves.toMatchObject({dataRoot: null})

	await Promise.all([fse.ensureDir(mediaSourcePath), fse.ensureDir(musicSourcePath)])
	const appCompose = yaml.load(originalComposeContents) as Record<string, any>
	appCompose.services.server.volumes = [
		'${APP_DATA_DIR}/data/server:/data',
		'${UMBREL_ROOT}/data/storage/downloads:/downloads',
		'${UMBREL_ROOT}/data/storage/downloads:/media-library:ro',
	]
	await fse.writeFile(composePath, yaml.dump(appCompose))
	const manifest = yaml.load(originalManifestContents) as AppManifest
	manifest.storage = {dataRoot: 'data'}
	manifest.folderAccess = [
		{
			id: 'music',
			name: 'Music library',
			note: 'Let this app use your music folder.',
			mounts: [
				{service: 'server', targetPath: '/music', readOnly: true},
				{service: 'server', targetPath: '/music-write', readOnly: false},
			],
		},
	]
	await fse.writeFile(manifestPath, yaml.dump(manifest))
	await installedApp.patchComposeFile()
	const patchedCompose = yaml.load(await fse.readFile(composePath, 'utf8')) as Record<string, any>
	expect(patchedCompose.services.server.volumes).toStrictEqual([
		{
			type: 'bind',
			source: '${APP_DATA_ROOT}/server',
			target: '/data',
			read_only: false,
			bind: {create_host_path: false},
		},
		'${UMBREL_ROOT}/home/Downloads:/downloads',
		'${UMBREL_ROOT}/home/Downloads:/media-library:ro',
	])

	await expect(getStorageSettings()).resolves.toMatchObject({
		dataRoot: {location: null, status: 'available'},
		occupiedTargets: expect.arrayContaining([{serviceName: 'server', targetPath: '/data'}]),
		folderAccess: expect.arrayContaining([
			{
				id: 'music',
				name: 'Music library',
				note: 'Let this app use your music folder.',
				mounts: [
					{serviceName: 'server', targetPath: '/music', readOnly: true},
					{serviceName: 'server', targetPath: '/music-write', readOnly: false},
				],
				defaultSourcePath: null,
				sourcePath: null,
			},
			{
				id: 'umbrel-downloads',
				name: 'Downloads',
				mounts: [
					{serviceName: 'server', targetPath: '/downloads', readOnly: false},
					{serviceName: 'server', targetPath: '/media-library', readOnly: true},
				],
				defaultSourcePath: '/Home/Downloads',
				sourcePath: null,
			},
		]),
		customMounts: [],
	})

	const customMount = {
		serviceName: 'server',
		targetPath: '/data',
		sourcePath: '/Home/Media Library',
		readOnly: false,
	}
	const folderAccess = {id: 'music', sourcePath: '/Home/Music Library'}
	const downloadsFolder = {id: 'umbrel-downloads', sourcePath: '/Home/Media Library'}
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			customMounts: [customMount],
			folderAccess: [folderAccess, downloadsFolder],
		}),
	).resolves.toStrictEqual(true)
	await waitForReady('setting folder access')

	const settings = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settings.customMounts).toStrictEqual([customMount])
	expect(settings.folderAccess).toStrictEqual([folderAccess, downloadsFolder])
	const userSettingsCompose = yaml.load(await fse.readFile(userSettingsComposePath, 'utf8'))
	expect(userSettingsCompose).toStrictEqual({
		services: {
			server: {
				volumes: [
					{
						type: 'bind',
						source: mediaSourcePath,
						target: '/data',
						read_only: false,
						bind: {create_host_path: false},
					},
					{
						type: 'bind',
						source: musicSourcePath,
						target: '/music',
						read_only: true,
						bind: {create_host_path: false},
					},
					{
						type: 'bind',
						source: musicSourcePath,
						target: '/music-write',
						read_only: false,
						bind: {create_host_path: false},
					},
					{
						type: 'bind',
						source: mediaSourcePath,
						target: '/downloads',
						read_only: false,
						bind: {create_host_path: false},
					},
					{
						type: 'bind',
						source: mediaSourcePath,
						target: '/media-library',
						read_only: true,
						bind: {create_host_path: false},
					},
				],
			},
		},
	})
	await expect(getStorageSettings()).resolves.toMatchObject({
		dataRoot: {location: null, status: 'available'},
		customMounts: [customMount],
		folderAccess: expect.arrayContaining([
			expect.objectContaining({
				...folderAccess,
				mounts: expect.arrayContaining([
					expect.objectContaining({serviceName: 'server', targetPath: '/music'}),
					expect.objectContaining({serviceName: 'server', targetPath: '/music-write'}),
				]),
			}),
			expect.objectContaining({
				id: 'umbrel-downloads',
				defaultSourcePath: '/Home/Downloads',
				sourcePath: downloadsFolder.sourcePath,
			}),
		]),
	})
	expect(umbreld.instance.apps.getFolderAccessPathRelation('/Home/Music Library')).toBe('folder-root')
	expect(umbreld.instance.apps.getFolderAccessPathRelation('/Home/Music Library/Albums')).toBe('inside-folder-root')
	expect(umbreld.instance.apps.getFolderAccessPathRelation('/Home/Music Library Archive')).toBeNull()

	// Advanced folder access can intentionally replace an app-provided mount,
	// while app-suggested targets remain owned by their friendly setting.
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			customMounts: [{...customMount, targetPath: '/music'}],
			folderAccess: [folderAccess, downloadsFolder],
		}),
	).rejects.toThrow("Mount '/music' in service 'server' already exists")

	// Home is shared user storage, not an app storage destination. Internal app
	// storage has its own canonical location; moves target external drives.
	const sourceDataRoot = path.join(appDataDirectory, 'data')
	await fse.ensureDir(sourceDataRoot)
	await fse.writeFile(path.join(sourceDataRoot, 'move-test.txt'), 'moved safely')

	for (const destinationParentPath of ['/Home/App Storage Integration Test', '/Network/test-nas/media']) {
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath})).rejects.toThrow(
			'Choose a folder on an external drive',
		)
	}
	await expect(fse.readFile(path.join(sourceDataRoot, 'move-test.txt'), 'utf8')).resolves.toBe('moved safely')
	await expect(getStorageSettings()).resolves.toMatchObject({dataRoot: {location: null, status: 'available'}})
	await fse.remove(path.join(sourceDataRoot, 'move-test.txt'))

	await expect(
		umbreld.client.apps.setSettings.mutate({appId, customMounts: [], folderAccess: []}),
	).resolves.toStrictEqual(true)
	const settingsAfterReset = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settingsAfterReset).not.toHaveProperty('customMounts')
	expect(settingsAfterReset).not.toHaveProperty('folderAccess')
	await waitForReady('resetting folder access')
	expect(umbreld.instance.apps.getFolderAccessPathRelation('/Home/Music Library')).toBeNull()
	expect(umbreld.instance.apps.getFolderAccessPathRelation('/Home/Downloads')).toBe('folder-root')

	// Restore the shared state used by the remaining sequential app tests.
	await Promise.all([
		fse.writeFile(composePath, originalComposeContents),
		fse.writeFile(manifestPath, originalManifestContents),
	])
	await umbreld.instance.apps.getApp(appId).regenerateUserSettingsCompose()
	await expect(fse.pathExists(userSettingsComposePath)).resolves.toBe(false)
})

test.sequential('moveDataRoot() moves app data and recovers every journal boundary', async () => {
	const appId = 'sparkles-hello-world'
	const app = umbreld.instance.apps.getApp(appId)
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const composePath = path.join(appDataDirectory, 'docker-compose.yml')
	const manifestPath = path.join(appDataDirectory, 'umbrel-app.yml')
	const sourceDataRoot = path.join(appDataDirectory, 'data')
	const storagePath = '/External/App Data Root Test'
	const destinationParentPath = `${storagePath}/User Chosen/Umbrel Apps`
	const filesystemUuid = 'app-data-root-test-filesystem'
	const destinationPath = `${destinationParentPath}/${appId}`
	const destination = {path: destinationPath, filesystemUuid}
	const externalSystemRoot = path.join(umbreld.instance.dataDirectory, 'external', 'App Data Root Test')
	const destinationSystemPath = path.join(externalSystemRoot, 'User Chosen', 'Umbrel Apps', appId)
	const destinationParentSystemPath = path.dirname(destinationSystemPath)
	const moveMarkerSystemPath = (token: string) => path.join(destinationSystemPath, `.umbrel-moving-${token}`)
	const originalComposeContents = await fse.readFile(composePath, 'utf8')
	const originalManifestContents = await fse.readFile(manifestPath, 'utf8')
	const originalGetStorageDestination = umbreld.instance.files.getStorageDestination.bind(umbreld.instance.files)
	const originalGetExternalStorageFilesystemType = umbreld.instance.files.getExternalStorageFilesystemType.bind(
		umbreld.instance.files,
	)
	const originalResolveStorageDestination = umbreld.instance.files.resolveStorageDestination.bind(
		umbreld.instance.files,
	)
	let storageAvailable = true
	const getStorageDestinationSpy = vi
		.spyOn(umbreld.instance.files, 'getStorageDestination')
		.mockImplementation(async (virtualPath, userId) => {
			if (virtualPath === destinationPath) return destination
			return originalGetStorageDestination(virtualPath, userId)
		})
	const getExternalStorageFilesystemTypeSpy = vi
		.spyOn(umbreld.instance.files, 'getExternalStorageFilesystemType')
		.mockImplementation(async (candidateFilesystemUuid) => {
			if (candidateFilesystemUuid === filesystemUuid) return 'ext4'
			return originalGetExternalStorageFilesystemType(candidateFilesystemUuid)
		})
	const resolveStorageDestinationSpy = vi
		.spyOn(umbreld.instance.files, 'resolveStorageDestination')
		.mockImplementation(async (storageDestination, userId, options = {}) => {
			if (storageDestination.filesystemUuid !== filesystemUuid) {
				return originalResolveStorageDestination(storageDestination, userId, options)
			}
			if (!storageAvailable) throw new Error('[cloud-destination-missing]')

			const relativePath = path.posix.relative(storagePath, storageDestination.path)
			if (relativePath.startsWith('..')) throw new Error('Test storage path escaped its mount')
			const systemPath = path.join(externalSystemRoot, ...relativePath.split('/').filter(Boolean))
			if (!options.allowMissing) {
				const stat = await fse.lstat(systemPath)
				if (!stat.isDirectory()) throw new Error('Test storage destination is not a directory')
			}
			return systemPath
		})
	const waitForReady = async (description: string) => {
		for (let i = 0; i < 60; i++) {
			const state = await umbreld.client.apps.state.query({appId})
			if (state.state === 'ready') return
			await setTimeout(1000)
		}
		throw new Error(`${appId} did not return to ready state after ${description}`)
	}
	const getStorageSettings = async () => {
		const installed = (await umbreld.client.apps.list.query()).find((candidate) => candidate.id === appId)
		if (!installed || 'error' in installed) throw new Error(`Failed to read installed app ${appId}`)
		return installed.storage
	}

	try {
		await fse.remove(externalSystemRoot)
		await fse.ensureDir(externalSystemRoot)
		const appCompose = yaml.load(originalComposeContents) as Record<string, any>
		const manifest = yaml.load(originalManifestContents) as AppManifest
		manifest.storage = {dataRoot: 'data'}
		await fse.writeFile(manifestPath, yaml.dump(manifest))

		// The published app definition remains compatible with older umbrelOS
		// versions. Newer umbreld versions redirect its declared data directory in
		// the installed Compose file while preserving the rest of the mount.
		appCompose.services.server.volumes = [
			{
				type: 'bind',
				source: '${APP_DATA_DIR}/data/server',
				target: '/data',
				read_only: false,
				bind: {create_host_path: true},
			},
		]
		await fse.writeFile(composePath, yaml.dump(appCompose))
		await app.patchComposeFile()
		const patchedCompose = yaml.load(await fse.readFile(composePath, 'utf8')) as Record<string, any>
		expect(patchedCompose.services.server.volumes).toStrictEqual([
			{
				type: 'bind',
				source: '${APP_DATA_ROOT}/server',
				target: '/data',
				read_only: false,
				bind: {create_host_path: false},
			},
		])
		await app.regenerateUserSettingsCompose()

		// Starting claims its lifecycle state before recovery performs any async work,
		// so a move cannot pass the settings gate after start has already begun.
		const concurrentStart = app.start()
		expect(app.state).toBe('starting')
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath})).rejects.toThrow(
			'apps-settings-blocked',
		)
		await expect(concurrentStart).resolves.toBe(true)

		// The app-specific destination becomes protected from Files synchronously
		// with the move reservation, so a user cannot create a colliding directory
		// after preflight and have recovery mistake it for app-owned data.
		await fse.ensureDir(destinationParentSystemPath)
		const releaseReservation = umbreld.instance.apps.beginStorageOperation(appId, [destinationPath])
		try {
			await expect(umbreld.client.files.createDirectory.mutate({path: destinationPath})).rejects.toThrow(
				'operation-not-allowed',
			)
			// The selected parent is still ordinary user storage. Protecting the
			// app-owned child must not make unrelated siblings read-only.
			const siblingPath = `${destinationParentPath}/unrelated-sibling`
			await expect(umbreld.client.files.createDirectory.mutate({path: siblingPath})).resolves.toEqual({
				created: true,
				identity: expect.any(Object),
			})
			await fse.remove(path.join(destinationParentSystemPath, 'unrelated-sibling'))
		} finally {
			releaseReservation()
		}

		await fse.ensureDir(path.join(sourceDataRoot, 'server'))
		await fse.writeFile(path.join(sourceDataRoot, 'server', 'move-test.txt'), 'authoritative app data')
		await fse.outputFile(path.join(destinationParentSystemPath, 'keep.txt'), 'unrelated user data')

		// The selected parent remains ordinary user storage. Umbrel neither adopts
		// nor replaces an existing app-named child inside it.
		await fse.outputFile(path.join(destinationSystemPath, 'user-file.txt'), 'not app data')
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath})).rejects.toThrow(
			'apps-data-root-destination-exists',
		)
		await expect(fse.readFile(path.join(destinationSystemPath, 'user-file.txt'), 'utf8')).resolves.toBe('not app data')
		await fse.remove(destinationSystemPath)

		// Exercise a complete move in both directions with the real copy, settings,
		// Compose regeneration, stop/start, marker, and cleanup paths. Only the
		// physical mount resolver is substituted by this deterministic test volume.
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath})).resolves.toBe(true)
		await waitForReady('moving to external storage')
		await expect(getStorageSettings()).resolves.toMatchObject({
			dataRoot: {location: destinationPath, status: 'available'},
		})
		await expect(fse.readFile(path.join(destinationSystemPath, 'server', 'move-test.txt'), 'utf8')).resolves.toBe(
			'authoritative app data',
		)
		await expect(fse.readdir(destinationSystemPath)).resolves.not.toContainEqual(
			expect.stringMatching(/^\.umbrel-moving-/),
		)
		await expect(fse.pathExists(sourceDataRoot)).resolves.toBe(false)

		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath: null})).resolves.toBe(true)
		await waitForReady('moving back to internal storage')
		await expect(fse.readFile(path.join(sourceDataRoot, 'server', 'move-test.txt'), 'utf8')).resolves.toBe(
			'authoritative app data',
		)
		await expect(fse.pathExists(destinationSystemPath)).resolves.toBe(false)
		await expect(fse.readFile(path.join(destinationParentSystemPath, 'keep.txt'), 'utf8')).resolves.toBe(
			'unrelated user data',
		)

		// A crash immediately after journaling may leave no destination directories
		// at all. Recovery treats that as an untouched source, not an error.
		const journalOnlyToken = '00000000-0000-4000-8000-000000000000'
		await app.store.set('dataRootMove', {source: null, destination, token: journalOnlyToken})
		await expect(umbreld.client.apps.restart.mutate({appId})).resolves.toBe(true)
		await waitForReady('recovering a journal-only move')
		await expect(app.store.get('dataRootMove')).resolves.toBeUndefined()

		// Corrupt transaction metadata does not brick ordinary lifecycle actions or
		// permanently block future moves. Recovery abandons the unusable journal.
		await app.store.update((settings) => {
			settings.dataRootMove = {source: null} as any
		})
		await expect(umbreld.client.apps.restart.mutate({appId})).resolves.toBe(true)
		await waitForReady('starting with a malformed move journal')
		await expect(app.store.get('dataRootMove')).resolves.toBeUndefined()
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath: null})).resolves.toBe(true)

		// A crash while copying leaves only a partial sibling staging directory.
		// The stored location still names the source, so recovery removes staging.
		const copyingToken = '00000000-0000-4000-8000-000000000001'
		const copyingStagingPath = `${path.posix.dirname(destinationPath)}/.${appId}-moving-${copyingToken}`
		const copyingStagingSystemPath = path.join(
			externalSystemRoot,
			...path.posix.relative(storagePath, copyingStagingPath).split('/'),
		)
		await fse.outputFile(path.join(copyingStagingSystemPath, 'partial.txt'), 'partial staging data')
		await app.store.set('dataRootMove', {source: null, destination, token: copyingToken})
		await expect(umbreld.client.apps.restart.mutate({appId})).resolves.toBe(true)
		await waitForReady('recovering an interrupted copy')
		await expect(app.store.get('dataRootMove')).resolves.toBeUndefined()
		await expect(fse.pathExists(copyingStagingSystemPath)).resolves.toBe(false)
		await expect(fse.readFile(path.join(sourceDataRoot, 'server', 'move-test.txt'), 'utf8')).resolves.toBe(
			'authoritative app data',
		)

		// If the final rename and transaction marker completed before the process
		// died, recovery can prove the destination belongs to this move. Keep that
		// proof inside the root until deletion finishes so an interrupted cleanup is
		// safe to retry.
		const renamedToken = '00000000-0000-4000-8000-000000000002'
		await fse.outputFile(path.join(destinationSystemPath, 'partial.txt'), 'partial destination data')
		await fse.outputJson(moveMarkerSystemPath(renamedToken), {appId, token: renamedToken})
		await app.store.set('dataRootMove', {source: null, destination, token: renamedToken})
		const originalRemove = fse.remove.bind(fse)
		const interruptedCleanup = vi.spyOn(fse, 'remove').mockImplementation(async (systemPath: string) => {
			if (path.resolve(systemPath) === path.resolve(destinationSystemPath)) {
				await expect(fse.pathExists(moveMarkerSystemPath(renamedToken))).resolves.toBe(true)
				throw new Error('simulated interrupted destination cleanup')
			}
			return originalRemove(systemPath)
		})
		try {
			await expect(umbreld.client.apps.restart.mutate({appId})).resolves.toBe(true)
			await expect(app.store.get('dataRootMove')).resolves.toMatchObject({token: renamedToken})
			await expect(fse.pathExists(moveMarkerSystemPath(renamedToken))).resolves.toBe(true)
		} finally {
			interruptedCleanup.mockRestore()
		}
		await expect(umbreld.client.apps.restart.mutate({appId})).resolves.toBe(true)
		await waitForReady('recovering a renamed destination')
		await expect(app.store.get('dataRootMove')).resolves.toBeUndefined()
		await expect(fse.pathExists(destinationSystemPath)).resolves.toBe(false)

		// A colliding directory without this move's marker is never deleted. Recovery
		// fails closed and leaves both the directory and journal for explicit repair.
		const collisionToken = '00000000-0000-4000-8000-000000000003'
		await fse.outputFile(path.join(destinationSystemPath, 'user-file.txt'), 'not app data')
		await app.store.set('dataRootMove', {source: null, destination, token: collisionToken})
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath})).rejects.toThrow(
			'apps-data-root-recovery-needed',
		)
		await expect(fse.readFile(path.join(destinationSystemPath, 'user-file.txt'), 'utf8')).resolves.toBe('not app data')
		await expect(app.store.get('dataRootMove')).resolves.toMatchObject({token: collisionToken})
		await fse.remove(destinationSystemPath)
		await app.store.delete('dataRootMove')

		// A crash after committing settings makes the destination authoritative.
		// Startup uses it, removes the obsolete source, and clears the journal.
		const committedToken = '00000000-0000-4000-8000-000000000004'
		await fse.copy(sourceDataRoot, destinationSystemPath)
		await fse.outputJson(moveMarkerSystemPath(committedToken), {appId, token: committedToken})
		await app.store.update((settings) => {
			settings.dataRootLocation = destination
			settings.dataRootMove = {
				source: null,
				destination,
				token: committedToken,
			}
		})
		umbreld.instance.apps.setDataRootLocation(appId, destination)
		await expect(umbreld.client.apps.restart.mutate({appId})).resolves.toBe(true)
		await waitForReady('recovering a committed move')
		await expect(app.store.get('dataRootMove')).resolves.toBeUndefined()
		await expect(fse.pathExists(sourceDataRoot)).resolves.toBe(false)
		await expect(fse.readFile(path.join(destinationSystemPath, 'server', 'move-test.txt'), 'utf8')).resolves.toBe(
			'authoritative app data',
		)
		await expect(fse.pathExists(moveMarkerSystemPath(committedToken))).resolves.toBe(false)

		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath: null})).resolves.toBe(true)
		await waitForReady('restoring internal storage after recovery')

		// If the backing storage is permanently lost, the user can explicitly
		// abandon it and initialize a clean internal root. The unreachable data is
		// never deleted, and an ordinary move remains the only option while it is available.
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath})).resolves.toBe(true)
		await waitForReady('preparing the unavailable-storage reset')
		await expect(umbreld.client.apps.resetDataRoot.mutate({appId})).rejects.toThrow('apps-data-root-reset-available')
		storageAvailable = false
		const originalStoreGet = app.store.get.bind(app.store)
		let failInitializationOnce = true
		const storeGetSpy = vi.spyOn(app.store, 'get').mockImplementation(async (...args: any[]) => {
			if (args[0] === 'dataRootResetPending' && failInitializationOnce) {
				failInitializationOnce = false
				throw new Error('simulated fresh initialization failure')
			}
			return (originalStoreGet as (...parameters: any[]) => Promise<any>)(...args)
		})
		try {
			// The location switch is already durable when initialization begins. Report
			// success, leave initialization pending, and keep the app offline for retry.
			await expect(umbreld.client.apps.resetDataRoot.mutate({appId})).resolves.toBe(true)
			await expect(getStorageSettings()).resolves.toMatchObject({
				dataRoot: {location: null, status: 'available'},
			})
			await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'unknown'})
			await expect(app.store.get('dataRootResetPending')).resolves.toBe(true)
		} finally {
			storeGetSpy.mockRestore()
		}

		await expect(umbreld.client.apps.start.mutate({appId})).resolves.toBe(true)
		await waitForReady('starting fresh on internal storage')
		await expect(getStorageSettings()).resolves.toMatchObject({
			dataRoot: {location: null, status: 'available'},
		})
		await expect(app.store.get('dataRootResetPending')).resolves.toBeUndefined()
		await expect(fse.pathExists(path.join(sourceDataRoot, 'server', 'move-test.txt'))).resolves.toBe(false)
		await expect(fse.readFile(path.join(destinationSystemPath, 'server', 'move-test.txt'), 'utf8')).resolves.toBe(
			'authoritative app data',
		)

		// Starting fresh for an intentionally stopped app initializes the new root
		// without changing its persisted auto-start choice.
		await fse.remove(destinationSystemPath)
		storageAvailable = true
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath})).resolves.toBe(true)
		await waitForReady('preparing a stopped-app reset')
		await expect(umbreld.client.apps.stop.mutate({appId})).resolves.toBe(true)
		await expect(app.shouldAutoStart()).resolves.toBe(false)
		storageAvailable = false
		await expect(umbreld.client.apps.resetDataRoot.mutate({appId})).resolves.toBe(true)
		await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'stopped'})
		await expect(app.shouldAutoStart()).resolves.toBe(false)
		await expect(app.store.get('dataRootResetPending')).resolves.toBeUndefined()
		await expect(umbreld.client.apps.start.mutate({appId})).resolves.toBe(true)
		await waitForReady('restoring the shared integration fixture')
	} finally {
		storageAvailable = true
		if (await app.getDataRootLocation().catch(() => null)) {
			await umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath: null}).catch(() => {})
		}
		await app.store.delete('dataRootMove').catch(() => {})
		umbreld.instance.apps.setDataRootLocation(appId, null)
		await Promise.all([
			fse.writeFile(composePath, originalComposeContents),
			fse.writeFile(manifestPath, originalManifestContents),
			fse.remove(externalSystemRoot),
		])
		await app.regenerateUserSettingsCompose()
		getStorageDestinationSpy.mockRestore()
		getExternalStorageFilesystemTypeSpy.mockRestore()
		resolveStorageDestinationSpy.mockRestore()
	}
})

test.sequential('folder access remains stable across saves, app changes, and missing storage', async () => {
	const appId = 'sparkles-hello-world'
	const app = umbreld.instance.apps.getApp(appId)
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const composePath = path.join(appDataDirectory, 'docker-compose.yml')
	const manifestPath = path.join(appDataDirectory, 'umbrel-app.yml')
	const sourceSystemPath = path.join(umbreld.instance.dataDirectory, 'home', 'Stable Media')
	const originalCompose = await fse.readFile(composePath, 'utf8')
	const originalManifest = await fse.readFile(manifestPath, 'utf8')
	const customMount = {
		serviceName: 'server',
		targetPath: '/media',
		sourcePath: '/Home/Stable Media',
		readOnly: false,
	}
	const waitForReady = async (description: string) => {
		for (let i = 0; i < 60; i++) {
			if ((await umbreld.client.apps.state.query({appId})).state === 'ready') return
			await setTimeout(1000)
		}
		throw new Error(`${appId} did not return to ready state after ${description}`)
	}

	try {
		await fse.ensureDir(sourceSystemPath)

		// Pause the settings write to prove lifecycle work cannot observe a partial
		// settings/Compose pair.
		const originalUpdate = app.store.update.bind(app.store)
		let releaseSave!: () => void
		const saveHeld = new Promise<void>((resolve) => (releaseSave = resolve))
		const updateSpy = vi.spyOn(app.store, 'update').mockImplementationOnce(async (job) => {
			await saveHeld
			return originalUpdate(job)
		})
		const save = umbreld.client.apps.setSettings.mutate({appId, customMounts: [customMount], folderAccess: []})
		for (let i = 0; updateSpy.mock.calls.length === 0 && i < 60; i++) await setTimeout(100)
		expect(updateSpy).toHaveBeenCalledOnce()
		await expect(umbreld.client.apps.start.mutate({appId})).rejects.toThrow('apps-settings-applying')
		releaseSave()
		await expect(save).resolves.toBe(true)
		updateSpy.mockRestore()
		await waitForReady('saving folder access')

		// A later app version may suggest the same target. Until the user selects
		// that suggestion, the existing custom mount remains the runtime authority.
		const manifest = yaml.load(originalManifest) as AppManifest
		manifest.folderAccess = [
			{
				id: 'media',
				name: 'Media',
				note: 'Let this app use your media folder.',
				mounts: [{service: 'server', targetPath: '/media'}],
			},
		]
		await fse.writeFile(manifestPath, yaml.dump(manifest))
		await app.regenerateUserSettingsCompose()
		const listed = (await umbreld.client.apps.list.query()).find((candidate) => candidate.id === appId)
		if (!listed || 'error' in listed) throw new Error(`Failed to read installed app ${appId}`)
		expect(listed.storage?.customMounts).toStrictEqual([customMount])
		expect(listed.storage?.folderAccess).toEqual([
			expect.objectContaining({
				id: 'media',
				mounts: [expect.objectContaining({serviceName: 'server', targetPath: '/media'})],
				sourcePath: null,
			}),
		])

		// Missing storage fails closed without losing the setting, and a storage
		// event retries the auto-start app when the same folder returns.
		await fse.remove(sourceSystemPath)
		await expect(umbreld.client.apps.restart.mutate({appId})).rejects.toThrow('does not exist')
		await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'unknown'})
		await fse.ensureDir(sourceSystemPath)
		await umbreld.instance.eventBus.emit('files:network-storage:change')
		await waitForReady('folder storage returning')
		await expect(umbreld.instance.apps.getAppsUsingStorageSource('/Home')).resolves.toStrictEqual(['Hello World'])

		await expect(umbreld.client.apps.stop.mutate({appId})).resolves.toBe(true)
		await expect(umbreld.instance.apps.getAppsUsingStorageSource('/Home')).resolves.toStrictEqual([])
		await expect(umbreld.client.apps.setSettings.mutate({appId, customMounts: [], folderAccess: []})).resolves.toBe(
			true,
		)
		await expect(umbreld.client.apps.start.mutate({appId})).resolves.toBe(true)
		await waitForReady('clearing folder access')
	} finally {
		await Promise.all([
			fse.writeFile(composePath, originalCompose),
			fse.writeFile(manifestPath, originalManifest),
			fse.remove(sourceSystemPath),
		])
		await app.store.update((settings) => {
			delete settings.customMounts
			delete settings.folderAccess
		})
		await app.regenerateUserSettingsCompose()
		if ((await umbreld.client.apps.state.query({appId})).state !== 'ready') {
			await umbreld.client.apps.start.mutate({appId}).catch(() => {})
		}
	}
})

test.sequential('network share removal stays blocked while folder access is active', async () => {
	const appId = 'sparkles-hello-world'
	const mountPath = '/Network/test-nas/media'
	const systemMountPath = path.join(umbreld.instance.dataDirectory, 'network', 'test-nas', 'media')
	const customMount = {
		serviceName: 'server',
		targetPath: '/nas-media',
		sourcePath: `${mountPath}/app-data`,
		readOnly: false,
	}
	await umbreld.instance.store.set('files.networkStorage', [
		{host: 'test-nas', share: 'media', username: 'test', password: 'test', mountPath},
	])
	await fse.ensureDir(path.join(systemMountPath, 'app-data'))
	await expect(
		umbreld.client.apps.setSettings.mutate({appId, customMounts: [customMount], folderAccess: []}),
	).resolves.toBe(true)
	for (let i = 0; i < 60; i++) {
		if ((await umbreld.client.apps.state.query({appId})).state === 'ready') break
		await setTimeout(1000)
	}

	await expect(umbreld.client.files.removeNetworkShare.mutate({mountPath})).rejects.toThrow('storage-in-use-by-apps')
	await expect(umbreld.client.apps.stop.mutate({appId})).resolves.toBe(true)
	await expect(umbreld.client.files.removeNetworkShare.mutate({mountPath})).resolves.toBe(true)
	await expect(umbreld.client.apps.setSettings.mutate({appId, customMounts: [], folderAccess: []})).resolves.toBe(true)
	await expect(umbreld.client.apps.start.mutate({appId})).resolves.toBe(true)
	for (let i = 0; i < 60; i++) {
		if ((await umbreld.client.apps.state.query({appId})).state === 'ready') break
		await setTimeout(1000)
	}
})

test.sequential('setSettings() rejects folder access outside allowed roots and during lifecycle changes', async () => {
	const appId = 'sparkles-hello-world'
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const settingsPath = path.join(appDataDirectory, 'settings.yml')
	const userSettingsComposePath = path.join(appDataDirectory, 'docker-compose.umbrel-user-settings.yml')
	const addMount = (sourcePath: string, targetPath = '/allowlist') => ({
		appId,
		customMounts: [
			{
				serviceName: 'server',
				targetPath,
				sourcePath,
				readOnly: false,
			},
		],
		folderAccess: [],
	})
	const settingsBefore = await fse.readFile(settingsPath, 'utf8')

	await expect(umbreld.client.apps.setSettings.mutate(addMount('/Home/../../etc'))).rejects.toThrow(
		"Source path '/etc' must be in /Home, /External, or a /Network share",
	)
	await expect(umbreld.client.apps.setSettings.mutate(addMount('/Trash/files'))).rejects.toThrow(
		"Source path '/Trash/files' must be in /Home, /External, or a /Network share",
	)
	await expect(umbreld.client.apps.setSettings.mutate(addMount('/External'))).rejects.toThrow(
		"Source path '/External' must be in /Home, /External, or a /Network share",
	)
	await expect(umbreld.client.apps.setSettings.mutate(addMount('/Network/nas'))).rejects.toThrow(
		"Source path '/Network/nas' must be in /Home, /External, or a /Network share",
	)
	await expect(umbreld.client.apps.setSettings.mutate(addMount('Home/files'))).rejects.toThrow(
		"Source path 'Home/files' must be absolute",
	)
	await expect(umbreld.client.apps.setSettings.mutate(addMount('/Home', '/'))).rejects.toThrow(
		"Container path '/' cannot be the root path",
	)
	await expect(umbreld.client.apps.setSettings.mutate(addMount('/Home', 'data'))).rejects.toThrow(
		"Container path 'data' must be absolute",
	)
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			customMounts: [],
			folderAccess: [{id: 'downloads', sourcePath: '/etc'}],
		}),
	).rejects.toThrow("Source path '/etc' must be in /Home, /External, or a /Network share")

	const app = umbreld.instance.apps.getApp(appId)
	const originalState = app.state
	app.state = 'restarting'
	try {
		await expect(umbreld.client.apps.setSettings.mutate({appId, customMounts: [], folderAccess: []})).rejects.toThrow(
			`[apps-settings-blocked] Cannot change settings for app '${appId}' while it is restarting`,
		)
	} finally {
		app.state = originalState
	}

	await expect(fse.readFile(settingsPath, 'utf8')).resolves.toBe(settingsBefore)
	await expect(fse.pathExists(userSettingsComposePath)).resolves.toBe(false)
})

test.sequential('setSettings() overrides and resets app environment variables', async () => {
	const appId = 'sparkles-hello-world'
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const composePath = path.join(appDataDirectory, 'docker-compose.yml')
	const manifestPath = path.join(appDataDirectory, 'umbrel-app.yml')
	const settingsPath = path.join(appDataDirectory, 'settings.yml')
	const userSettingsComposePath = path.join(appDataDirectory, 'docker-compose.umbrel-user-settings.yml')
	const getEnvironment = async () => {
		const app = (await umbreld.client.apps.list.query()).find((app) => app.id === appId)
		if (!app || 'error' in app) throw new Error(`Failed to read installed app ${appId}`)
		return app.environment
	}
	const waitForReady = async (description: string) => {
		for (let i = 0; i < 60; i++) {
			const state = await umbreld.client.apps.state.query({appId})
			if (state.state === 'ready') return
			await setTimeout(1000)
		}

		throw new Error(`${appId} did not return to ready state after ${description}`)
	}

	// A second service makes explicit service targeting observable
	const appCompose = yaml.load(await fse.readFile(composePath, 'utf8')) as Record<string, any>
	appCompose.services.server.environment = ['PUID=1000']
	appCompose.services.worker = {
		...appCompose.services.server,
		environment: {WIDGET_ONLY: 'yes'},
	}
	delete appCompose.services.worker.container_name
	await fse.writeFile(composePath, yaml.dump(appCompose))
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	manifest.environment = [
		{
			name: 'PUID',
			services: ['server', 'worker'],
			default: '1000',
			options: ['1000', '2000', '3000'],
			note: 'User ID the app runs as',
		},
		{name: 'TZ', services: ['server'], default: 'Etc/UTC'},
	]
	await fse.writeFile(manifestPath, yaml.dump(manifest))

	// Exposed variables show their manifest metadata before any override is saved
	await expect(getEnvironment()).resolves.toMatchObject({
		exposed: [
			{
				name: 'PUID',
				services: ['server', 'worker'],
				default: '1000',
				options: ['1000', '2000', '3000'],
				note: 'User ID the app runs as',
				value: null,
			},
			{name: 'TZ', services: ['server'], default: 'Etc/UTC', value: null},
		],
		custom: [],
		services: ['server', 'worker'],
	})

	// Invalid and duplicate app-declared values are rejected
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			environment: [{name: 'BAD NAME', value: 'x'}],
		}),
	).rejects.toThrow(`Invalid environment variable name 'BAD NAME'`)
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			environment: [{name: 'NOT_EXPOSED', value: 'x'}],
		}),
	).rejects.toThrow(`Environment variable 'NOT_EXPOSED' is not exposed by this app`)
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			environment: [
				{name: 'PUID', value: '1'},
				{name: 'PUID', value: '2'},
			],
		}),
	).rejects.toThrow(`Only one value can be set for environment variable 'PUID'`)
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			environment: [{name: 'PUID', value: '9999'}],
		}),
	).rejects.toThrow(`'9999' is not a valid value for environment variable 'PUID'`)

	// Advanced values require an exact current service and are unique per service
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			customEnvironment: [{serviceName: 'missing', name: 'PUID', value: 'x'}],
		}),
	).rejects.toThrow(`Service 'missing' does not exist`)
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			customEnvironment: [
				{serviceName: 'server', name: 'PUID', value: '1'},
				{serviceName: 'server', name: 'PUID', value: '2'},
			],
		}),
	).rejects.toThrow(`Only one value can be set for environment variable 'PUID' in service 'server'`)

	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			environment: [
				{name: 'PUID', value: '2000'},
				{name: 'TZ', value: 'Australia/Brisbane'},
			],
			customEnvironment: [
				{serviceName: 'worker', name: 'PUID', value: '3000'},
				{serviceName: 'worker', name: 'WIDGET_ONLY', value: 'no'},
				{serviceName: 'server', name: 'UMBREL_TEST_VAR', value: 'hello server'},
				{serviceName: 'worker', name: 'UMBREL_TEST_VAR', value: 'hello worker'},
				{serviceName: 'server', name: 'PASSWORD', value: 'pa$word'},
			],
		}),
	).resolves.toStrictEqual(true)

	// Values are stored raw
	const settings = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settings.environment).toStrictEqual([
		{name: 'PUID', value: '2000'},
		{name: 'TZ', value: 'Australia/Brisbane'},
	])
	expect(settings.customEnvironment).toStrictEqual([
		{serviceName: 'worker', name: 'PUID', value: '3000'},
		{serviceName: 'worker', name: 'WIDGET_ONLY', value: 'no'},
		{serviceName: 'server', name: 'UMBREL_TEST_VAR', value: 'hello server'},
		{serviceName: 'worker', name: 'UMBREL_TEST_VAR', value: 'hello worker'},
		{serviceName: 'server', name: 'PASSWORD', value: 'pa$word'},
	])

	// App values follow manifest targets. Advanced values apply afterward to one
	// exact service, and '$' remains literal through Compose interpolation.
	const userSettingsCompose = yaml.load(await fse.readFile(userSettingsComposePath, 'utf8'))
	expect(userSettingsCompose).toStrictEqual({
		services: {
			server: {
				environment: {
					PUID: '2000',
					TZ: 'Australia/Brisbane',
					UMBREL_TEST_VAR: 'hello server',
					PASSWORD: 'pa$$word',
				},
			},
			worker: {environment: {PUID: '3000', WIDGET_ONLY: 'no', UMBREL_TEST_VAR: 'hello worker'}},
		},
	})

	await expect(getEnvironment()).resolves.toMatchObject({
		exposed: [
			{
				name: 'PUID',
				services: ['server', 'worker'],
				default: '1000',
				options: ['1000', '2000', '3000'],
				note: 'User ID the app runs as',
				value: '2000',
			},
			{name: 'TZ', services: ['server'], default: 'Etc/UTC', value: 'Australia/Brisbane'},
		],
		custom: [
			{serviceName: 'worker', name: 'PUID', value: '3000'},
			{serviceName: 'worker', name: 'WIDGET_ONLY', value: 'no'},
			{serviceName: 'server', name: 'UMBREL_TEST_VAR', value: 'hello server'},
			{serviceName: 'worker', name: 'UMBREL_TEST_VAR', value: 'hello worker'},
			{serviceName: 'server', name: 'PASSWORD', value: 'pa$word'},
		],
	})
	await waitForReady('setting environment variables')

	// An app update may remove a previously selected option. Keep that saved
	// value until the user chooses a replacement instead of blocking other edits.
	manifest.environment[0]!.options = ['1000', '3000']
	await fse.writeFile(manifestPath, yaml.dump(manifest))
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			environment: [
				{name: 'PUID', value: '2000'},
				{name: 'TZ', value: 'Australia/Sydney'},
			],
		}),
	).resolves.toStrictEqual(true)
	await waitForReady('preserving a removed environment option')
	manifest.environment[0]!.options = ['1000', '2000', '3000']
	await fse.writeFile(manifestPath, yaml.dump(manifest))

	// App-declared values follow manifest target changes without rewriting the
	// saved setting. Here PUID shrinks while TZ expands to the worker.
	manifest.environment = [
		{name: 'PUID', services: ['server'], default: '1000'},
		{name: 'TZ', services: ['server', 'worker'], default: 'Etc/UTC'},
	]
	await fse.writeFile(manifestPath, yaml.dump(manifest))
	await umbreld.instance.apps.getApp(appId).regenerateUserSettingsCompose()
	const settingsAfterTargetChange = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settingsAfterTargetChange.environment).toStrictEqual([
		{name: 'PUID', value: '2000'},
		{name: 'TZ', value: 'Australia/Sydney'},
	])
	expect(yaml.load(await fse.readFile(userSettingsComposePath, 'utf8'))).toStrictEqual({
		services: {
			server: {
				environment: {
					PUID: '2000',
					TZ: 'Australia/Sydney',
					UMBREL_TEST_VAR: 'hello server',
					PASSWORD: 'pa$$word',
				},
			},
			worker: {
				environment: {
					TZ: 'Australia/Sydney',
					PUID: '3000',
					WIDGET_ONLY: 'no',
					UMBREL_TEST_VAR: 'hello worker',
				},
			},
		},
	})

	// Removed declarations become dormant; they never turn into advanced values.
	manifest.environment = []
	await fse.writeFile(manifestPath, yaml.dump(manifest))
	await umbreld.instance.apps.getApp(appId).regenerateUserSettingsCompose()
	await expect(getEnvironment()).resolves.toMatchObject({
		exposed: [],
		custom: [
			{serviceName: 'worker', name: 'PUID', value: '3000'},
			{serviceName: 'worker', name: 'WIDGET_ONLY', value: 'no'},
			{serviceName: 'server', name: 'UMBREL_TEST_VAR', value: 'hello server'},
			{serviceName: 'worker', name: 'UMBREL_TEST_VAR', value: 'hello worker'},
			{serviceName: 'server', name: 'PASSWORD', value: 'pa$word'},
		],
	})
	expect(yaml.load(await fse.readFile(userSettingsComposePath, 'utf8'))).toStrictEqual({
		services: {
			server: {environment: {UMBREL_TEST_VAR: 'hello server', PASSWORD: 'pa$$word'}},
			worker: {environment: {PUID: '3000', WIDGET_ONLY: 'no', UMBREL_TEST_VAR: 'hello worker'}},
		},
	})

	// Editing a declaration that still exists must not erase a different value
	// whose declaration is temporarily absent.
	manifest.environment = [{name: 'TZ', services: ['server'], default: 'Etc/UTC'}]
	await fse.writeFile(manifestPath, yaml.dump(manifest))
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			environment: [{name: 'TZ', value: 'Pacific/Auckland'}],
		}),
	).resolves.toStrictEqual(true)
	await waitForReady('editing an exposed environment variable')
	let settingsAfterDormantEdit = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settingsAfterDormantEdit.environment).toStrictEqual([
		{name: 'PUID', value: '2000'},
		{name: 'TZ', value: 'Pacific/Auckland'},
	])

	// The same scoped replacement applies to advanced values: removing the
	// visible service's values leaves settings for an absent service dormant.
	delete appCompose.services.worker
	await fse.writeFile(composePath, yaml.dump(appCompose))
	await expect(
		umbreld.client.apps.setSettings.mutate({appId, environment: [], customEnvironment: []}),
	).resolves.toStrictEqual(true)
	await waitForReady('preserving dormant environment variables')
	settingsAfterDormantEdit = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settingsAfterDormantEdit.environment).toStrictEqual([{name: 'PUID', value: '2000'}])
	expect(settingsAfterDormantEdit.customEnvironment).toStrictEqual([
		{serviceName: 'worker', name: 'PUID', value: '3000'},
		{serviceName: 'worker', name: 'WIDGET_ONLY', value: 'no'},
		{serviceName: 'worker', name: 'UMBREL_TEST_VAR', value: 'hello worker'},
	])
	await expect(fse.pathExists(userSettingsComposePath)).resolves.toBe(false)

	// Once those settings are visible again, clearing them removes every value.
	manifest.environment = [{name: 'PUID', services: ['server'], default: '1000'}]
	appCompose.services.worker = {
		...appCompose.services.server,
		environment: {WIDGET_ONLY: 'yes'},
	}
	delete appCompose.services.worker.container_name
	await Promise.all([
		fse.writeFile(manifestPath, yaml.dump(manifest)),
		fse.writeFile(composePath, yaml.dump(appCompose)),
	])
	await expect(
		umbreld.client.apps.setSettings.mutate({appId, environment: [], customEnvironment: []}),
	).resolves.toStrictEqual(true)
	const settingsAfterReset = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
	expect(settingsAfterReset).not.toHaveProperty('environment')
	expect(settingsAfterReset).not.toHaveProperty('customEnvironment')
	await expect(fse.pathExists(userSettingsComposePath)).resolves.toBe(false)
	await waitForReady('resetting environment variables')
})

test.sequential('setSettings() saves dependencies with other settings in one restart', async () => {
	const appId = 'sparkles-hello-world'
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const manifestPath = path.join(appDataDirectory, 'umbrel-app.yml')
	const settingsPath = path.join(appDataDirectory, 'settings.yml')
	const waitForReady = async (description: string) => {
		for (let i = 0; i < 60; i++) {
			const state = await umbreld.client.apps.state.query({appId})
			if (state.state === 'ready') return
			await setTimeout(1000)
		}

		throw new Error(`${appId} did not return to ready state after ${description}`)
	}

	// Give the app a dependency slot to select a provider for
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	manifest.dependencies = ['bitcoin']
	await fse.writeFile(manifestPath, yaml.dump(manifest))
	// Dependency settings only accept installed providers. This stopped fixture
	// supplies the provider metadata without needing another running container.
	const provider = new App(umbreld.instance, 'bitcoin-knots')
	await fse.ensureDir(provider.dataDirectory)
	await fse.writeFile(
		path.join(provider.dataDirectory, 'umbrel-app.yml'),
		yaml.dump({manifestVersion: '1.0.0', name: 'Bitcoin Knots', implements: ['bitcoin']}),
	)
	await provider.writeCompose({services: {}})
	provider.state = 'stopped'
	umbreld.instance.apps.instances.push(provider)
	const app = umbreld.instance.apps.getApp(appId)
	const restartSpy = vi.spyOn(app, 'restart')
	try {
		// A dependency change combined with another setting saves in one call with
		// one restart. Two sequential mutations would fail here: the first save's
		// restart puts the app in a transient state that rejects the second.
		await expect(
			umbreld.client.apps.setSettings.mutate({
				appId,
				dependencies: {bitcoin: 'bitcoin-knots'},
				customEnvironment: [{serviceName: 'server', name: 'UMBREL_TEST_COMBINED_SAVE', value: 'together'}],
			}),
		).resolves.toStrictEqual(true)
		expect(restartSpy).toHaveBeenCalledTimes(1)

		// Both fields persisted in the one write
		const settings = yaml.load(await fse.readFile(settingsPath, 'utf8')) as Record<string, unknown>
		expect(settings.dependencies).toStrictEqual({bitcoin: 'bitcoin-knots'})
		expect(settings.customEnvironment).toStrictEqual([
			{serviceName: 'server', name: 'UMBREL_TEST_COMBINED_SAVE', value: 'together'},
		])

		await waitForReady('saving dependencies with other settings')

		// list() reflects the selection
		const listedApp = (await umbreld.client.apps.list.query()).find((app) => app.id === appId)
		if (!listedApp || 'error' in listedApp) throw new Error(`Failed to read installed app ${appId}`)
		expect(listedApp.selectedDependencies).toStrictEqual({bitcoin: 'bitcoin-knots'})

		// Re-saving the same selections skips the restart
		await expect(
			umbreld.client.apps.setSettings.mutate({appId, dependencies: {bitcoin: 'bitcoin-knots'}}),
		).resolves.toStrictEqual(true)
		expect(restartSpy).toHaveBeenCalledTimes(1)

		// Restore the manifest and clear the settings for the following tests
		manifest.dependencies = []
		await fse.writeFile(manifestPath, yaml.dump(manifest))
		await expect(umbreld.client.apps.setSettings.mutate({appId, customEnvironment: []})).resolves.toStrictEqual(true)
		await waitForReady('resetting dependencies and environment')
	} finally {
		restartSpy.mockRestore()
		umbreld.instance.apps.instances = umbreld.instance.apps.instances.filter((app) => app !== provider)
		await fse.remove(provider.dataDirectory)
	}
})

test.sequential('getBackupIgnoredPaths() returns sanitised absolute paths for installed app', async () => {
	const dataDir = umbreld.instance.dataDirectory
	const expected = ['data', 'logs', 'cache'].map((p) => path.join(dataDir, 'app-data', 'sparkles-hello-world', p))
	await expect(umbreld.client.apps.getBackupIgnoredPaths.query({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(
		expected,
	)
})

test.sequential('getBackupIgnoredPaths() does not resolve moved data already excluded from backups', async () => {
	const appId = 'sparkles-hello-world'
	const app = umbreld.instance.apps.getApp(appId)
	const location = {
		path: `/Network/offline/share/My Apps/${appId}`,
		host: 'offline',
		share: 'share',
	}
	await app.store.set('dataRootLocation', location)
	umbreld.instance.apps.setDataRootLocation(appId, location)
	try {
		const base = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
		await expect(umbreld.client.apps.getBackupIgnoredPaths.query({appId})).resolves.toStrictEqual([
			path.join(base, 'logs'),
			path.join(base, 'cache'),
		])
	} finally {
		await app.store.delete('dataRootLocation')
		umbreld.instance.apps.setDataRootLocation(appId, null)
	}
})

test.sequential("getBackupIgnoredPaths() supports '*' globs", async () => {
	// Modify manifest to include glob patterns
	const manifestPath = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world', 'umbrel-app.yml')
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	manifest.backupIgnore = ['data/*', 'logs/*']
	await fse.writeFile(manifestPath, yaml.dump(manifest))

	// Compute expected absolute paths for valid entries
	const base = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world')
	const expected = [path.join(base, 'data/*'), path.join(base, 'logs/*')]

	const result = await umbreld.client.apps.getBackupIgnoredPaths.query({appId: 'sparkles-hello-world'})

	// Should include valid globbed paths
	expect(result).toEqual(expected)
})

test.sequential('getBackupIgnoredPaths() ignores unsupported globbing characters', async () => {
	// Modify manifest to include unsupported glob patterns
	const manifestPath = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world', 'umbrel-app.yml')
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	manifest.backupIgnore = [
		'logs/*', // valid simple glob we support
		'logs/?', // unsupported single-char glob
		'logs/[a]', // unsupported character class
		'logs/{a}', // unsupported brace expansion
	]
	await fse.writeFile(manifestPath, yaml.dump(manifest))

	// Expect only the valid '*' glob to be returned (sanitised absolute path)
	const base = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world')
	const expected = [path.join(base, 'logs/*')]

	const result = await umbreld.client.apps.getBackupIgnoredPaths.query({appId: 'sparkles-hello-world'})

	expect(result).toEqual(expected)
})

test.sequential('getBackupIgnoredPaths() returns empty array when app has no backupIgnore paths', async () => {
	// Remove backupIgnore from installed app's manifest
	const manifestPath = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world', 'umbrel-app.yml')
	const original = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	delete original.backupIgnore
	await fse.writeFile(manifestPath, yaml.dump(original))

	await expect(umbreld.client.apps.getBackupIgnoredPaths.query({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(
		[],
	)
})

test.sequential('auto-reinstalls app when data directory is missing on first boot after restore', async () => {
	// Ensure the app is currently installed (from previous sequential test)
	const preApps = await umbreld.client.apps.list.query()
	expect(preApps.some((a: any) => a.id === 'sparkles-hello-world')).toBe(true)

	// Simulate excluded-from-backup state by removing the app's data directory while keeping the app ID in the store
	await umbreld.instance.stop()
	const appDataDir = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world')
	await fse.remove(appDataDir)

	// Touch the restore-first-start marker to indicate this is a restore boot
	const restoreFlagPath = path.join(umbreld.instance.dataDirectory, BACKUP_RESTORE_FIRST_START_FLAG)
	await fse.ensureFile(restoreFlagPath)

	// Start umbreld; missing app should be auto-reinstalled in background
	await umbreld.instance.start()
	// Restore boots deliberately revoke every existing session. Authenticate
	// again just as the dashboard requires after restored account data returns.
	await umbreld.login()
	// Re-install can complete quickly so we skip asserting initial absence to avoid flakiness.

	// Poll until the app reaches ready state (auto-installed and started)
	let ready = false
	for (let i = 0; i < 60; i++) {
		const state: any = await umbreld.client.apps.state.query({appId: 'sparkles-hello-world'}).catch(() => null)
		if (state?.state === 'ready') {
			ready = true
			break
		}
		await setTimeout(1000)
	}
	expect(ready).toBe(true)
})

test.sequential('does not missing data-dir app on non-restore boot', async () => {
	// Remove data dir without creating the restore marker
	await umbreld.instance.stop()
	const appDataDir = path.join(umbreld.instance.dataDirectory, 'app-data', 'sparkles-hello-world')
	await fse.remove(appDataDir)

	// We spy on apps.install to prove "no scheduling occurred" when the marker is absent.
	const installSpy = vi.spyOn(umbreld.instance.apps, 'install')

	// Reset the per-boot flag that was set to true by the previous test
	umbreld.instance.isBackupRestoreFirstStart = false

	// Start umbreld; without marker we should NOT auto-reinstall (i.e., install should never be called)
	await umbreld.instance.start()

	// Wait a few seconds then assert no install was invoked
	await setTimeout(5000)
	expect(installSpy).not.toHaveBeenCalled()
	// And the data directory should still be missing
	await expect(fse.pathExists(appDataDir)).resolves.toBe(false)

	installSpy.mockRestore()
})

test.sequential('restart() restarts an installed app', async () => {
	// Ensure installed for restart (previous tests may leave it uninstalled)
	await umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'}).catch(() => {})
	const app = umbreld.instance.apps.instances.find(({id}) => id === 'sparkles-hello-world')!
	const patchComposeFile = vi.spyOn(app, 'patchComposeFile')
	await expect(umbreld.client.apps.restart.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	expect(patchComposeFile).toHaveBeenCalledOnce()
	patchComposeFile.mockRestore()
})

test.sequential('failed lifecycle actions leave an app in a recoverable state', async () => {
	const appId = 'sparkles-hello-world'
	const composeFile = path.join(umbreld.instance.dataDirectory, 'app-data', appId, 'docker-compose.yml')

	const expectActionFailure = async (action: () => Promise<unknown>) => {
		const originalCompose = await fse.readFile(composeFile, 'utf8')
		try {
			await fse.writeFile(composeFile, `${originalCompose}\ninvalid: [`)
			await expect(action()).rejects.toThrow()
			await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'unknown'})
		} finally {
			await fse.writeFile(composeFile, originalCompose)
		}
	}

	// Starting can fail while parsing the compose file before Docker is invoked.
	await expect(umbreld.client.apps.stop.mutate({appId})).resolves.toBe(true)
	await expectActionFailure(() => umbreld.client.apps.start.mutate({appId}))
	await expect(umbreld.client.apps.start.mutate({appId})).resolves.toBe(true)

	// Stop and restart pass the compose file to Docker and can fail there.
	await expectActionFailure(() => umbreld.client.apps.stop.mutate({appId}))
	await expect(umbreld.client.apps.restart.mutate({appId})).resolves.toBe(true)
	await expectActionFailure(() => umbreld.client.apps.restart.mutate({appId}))
	await expect(umbreld.client.apps.restart.mutate({appId})).resolves.toBe(true)
})

test.sequential('update() updates an installed app', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
})

test.sequential('update() reports folder access invalidated by a removed service', async () => {
	const appId = 'sparkles-hello-world'
	const appDataDirectory = path.join(umbreld.instance.dataDirectory, 'app-data', appId)
	const composePath = path.join(appDataDirectory, 'docker-compose.yml')
	const sourceSystemPath = path.join(umbreld.instance.dataDirectory, 'home', 'Update Media')
	const notification = `app-storage-settings-changed:${appId}`
	await fse.ensureDir(sourceSystemPath)

	// Add a service to the installed definition and point a custom mount at it.
	// Updating restores the store definition without that service, so the saved
	// mount can no longer be applied.
	const compose = yaml.load(await fse.readFile(composePath, 'utf8')) as Record<string, any>
	compose.services.retired = {image: 'alpine:latest'}
	await fse.writeFile(composePath, yaml.dump(compose))
	await expect(umbreld.client.apps.stop.mutate({appId})).resolves.toBe(true)
	await expect(
		umbreld.client.apps.setSettings.mutate({
			appId,
			customMounts: [
				{
					serviceName: 'retired',
					targetPath: '/media',
					sourcePath: '/Home/Update Media',
					readOnly: false,
				},
			],
			folderAccess: [],
		}),
	).resolves.toBe(true)
	await expect(umbreld.client.notifications.get.query()).resolves.not.toContain(notification)

	await expect(umbreld.client.apps.update.mutate({appId})).resolves.toBe(true)
	await expect(umbreld.client.notifications.get.query()).resolves.toContain(notification)
	const listed = (await umbreld.client.apps.list.query()).find((candidate) => candidate.id === appId)
	if (!listed || 'error' in listed) throw new Error(`Failed to read installed app ${appId}`)
	expect(listed.storage?.customMounts).toStrictEqual([])
	await expect(umbreld.instance.apps.getApp(appId).store.get('customMounts')).resolves.toBeUndefined()

	await expect(umbreld.client.apps.setSettings.mutate({appId, customMounts: [], folderAccess: []})).resolves.toBe(true)
	await expect(umbreld.client.notifications.get.query()).resolves.not.toContain(notification)
	await fse.remove(sourceSystemPath)
})

test.sequential("umbreld restart doesn't start stopped apps", async () => {
	// Stop the app
	await expect(umbreld.client.apps.stop.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)

	// Restart umbreld
	await umbreld.instance.stop()
	await umbreld.instance.start()

	// Verify the previously stopped app is still stopped
	await expect(umbreld.client.apps.state.query({appId: 'sparkles-hello-world'})).resolves.toMatchObject({
		state: 'stopped',
		progress: 0,
	})
})

test.sequential('umbreld restart starts all non-stopped apps', async () => {
	// Start the previosly stopped app
	await expect(umbreld.client.apps.start.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)

	// Restart umbreld
	await umbreld.instance.stop()
	await umbreld.instance.start()

	// Verify the previously stopped app has started
	await expect(umbreld.client.apps.state.query({appId: 'sparkles-hello-world'})).resolves.toSatisfy((value) =>
		['starting', 'ready'].includes((value as any).state),
	)
})

test.sequential('trackOpen() tracks an app open', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
})

test.sequential('setTorEnabled() toggles the Tor setting', async () => {
	await expect(umbreld.client.apps.setTorEnabled.mutate(true)).resolves.toStrictEqual(true)
	await expect(umbreld.client.apps.getTorEnabled.query()).resolves.toStrictEqual(true)
	await expect(umbreld.client.apps.setTorEnabled.mutate(false)).resolves.toStrictEqual(true)
	await expect(umbreld.client.apps.getTorEnabled.query()).resolves.toStrictEqual(false)
})

test.sequential('uninstall() removes available app-owned external storage', async () => {
	const appId = 'sparkles-hello-world'
	const app = umbreld.instance.apps.getApp(appId)
	const location = {
		path: `/External/Owned Drive/My Apps/${appId}`,
		filesystemUuid: 'owned-filesystem',
	}
	const systemPath = path.join(umbreld.instance.dataDirectory, 'external', 'Owned Drive', 'My Apps', appId)
	await fse.outputFile(path.join(systemPath, 'owned.txt'), 'app-owned data')
	await app.store.set('dataRootLocation', location)
	umbreld.instance.apps.setDataRootLocation(appId, location)

	const originalResolveStorageDestination = umbreld.instance.files.resolveStorageDestination.bind(
		umbreld.instance.files,
	)
	const resolveStorageDestinationSpy = vi
		.spyOn(umbreld.instance.files, 'resolveStorageDestination')
		.mockImplementation((destination, userId, options) => {
			if (destination.filesystemUuid === location.filesystemUuid) return Promise.resolve(systemPath)
			return originalResolveStorageDestination(destination, userId, options)
		})
	try {
		await expect(umbreld.client.apps.uninstall.mutate({appId})).resolves.toStrictEqual(true)
		await expect(fse.pathExists(systemPath)).resolves.toBe(false)
	} finally {
		resolveStorageDestinationSpy.mockRestore()
		await fse.remove(path.join(umbreld.instance.dataDirectory, 'external', 'Owned Drive'))
	}

	await expect(umbreld.client.apps.install.mutate({appId})).resolves.toStrictEqual(true)
})

test.sequential('uninstall() succeeds while moved app storage is unavailable', async () => {
	const appId = 'sparkles-hello-world'
	const app = umbreld.instance.apps.getApp(appId)
	const unavailableLocation = {
		path: `/External/Missing Drive/My Apps/${appId}`,
		filesystemUuid: 'missing-filesystem',
	}
	const staleSystemPath = path.join(umbreld.instance.dataDirectory, 'external', 'Missing Drive', 'My Apps', appId)
	await fse.outputFile(path.join(staleSystemPath, 'must-not-delete.txt'), 'unverified app data')
	await app.store.set('dataRootLocation', unavailableLocation)
	umbreld.instance.apps.setDataRootLocation(appId, unavailableLocation)

	const member = await umbreld.client.user.createUser.mutate({name: 'app-share-member', password: 'passwordpassword'})
	await umbreld.client.apps.addMemberShare.mutate({appId, sharedWith: [member.userId]})
	await umbreld.client.apps.addMemberShare.mutate({appId: '*', sharedWith: 'all'})

	await expect(umbreld.client.apps.uninstall.mutate({appId})).resolves.toStrictEqual(true)
	// A stale directory at the expected mountpoint is not proof that the selected
	// filesystem is present. Uninstall leaves it untouched rather than risking a
	// deletion on the wrong filesystem.
	await expect(fse.readFile(path.join(staleSystemPath, 'must-not-delete.txt'), 'utf8')).resolves.toBe(
		'unverified app data',
	)
	await fse.remove(path.join(umbreld.instance.dataDirectory, 'external', 'Missing Drive'))

	// Direct grants belong to this installation and must not silently return on
	// reinstall. The explicit wildcard grant intentionally covers future apps.
	await expect(umbreld.client.apps.memberShares.query()).resolves.toStrictEqual([{appId: '*', sharedWith: 'all'}])
})

test.sequential('uninstall() can force local teardown with malformed storage metadata', async () => {
	const appId = 'sparkles-hello-world'
	await expect(umbreld.client.apps.install.mutate({appId})).resolves.toStrictEqual(true)
	const app = umbreld.instance.apps.getApp(appId)
	await app.store.update((settings) => {
		settings.dataRootLocation = {path: '/malformed'}
	})

	await expect(umbreld.client.apps.uninstall.mutate({appId})).resolves.toStrictEqual(true)
})

test.sequential('list() lists no apps after uninstall', async () => {
	const installedApps = await umbreld.client.apps.list.query()
	expect(installedApps.length).toStrictEqual(0)
})

async function startAppAuthUi() {
	if (process.env.UMBREL_UI_PROXY) return async () => {}

	const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
	const uiDirectory = path.resolve(currentDirectory, '../../../../ui')
	const vite = path.join(uiDirectory, 'node_modules/.bin/vite')
	if (!(await fse.pathExists(vite))) {
		throw new Error(`App auth integration test requires UI dependencies at ${vite}`)
	}

	const port = await getPort({host: '127.0.0.1'})
	const viteProcess = $({
		cwd: uiDirectory,
		reject: false,
	})`${vite} --host 127.0.0.1 --port ${port} --strictPort`
	process.env.UMBREL_UI_PROXY = `http://127.0.0.1:${port}`
	try {
		await pRetry(
			async () => {
				const response = await fetch(`http://127.0.0.1:${port}/app-auth/`)
				if (!response.ok) throw new Error(`App auth Vite server returned ${response.status}`)
			},
			{retries: 100, factor: 1, minTimeout: 100, maxTimeout: 100},
		)
	} catch (error) {
		viteProcess.kill('SIGTERM')
		await viteProcess
		delete process.env.UMBREL_UI_PROXY
		throw error
	}

	return async () => {
		delete process.env.UMBREL_UI_PROXY
		viteProcess.kill('SIGTERM')
		await viteProcess
	}
}
