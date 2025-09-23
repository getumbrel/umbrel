import {setTimeout} from 'node:timers/promises'
import path from 'node:path'
import {expect, beforeAll, afterAll, test} from 'vitest'
import fse from 'fs-extra'
import yaml from 'js-yaml'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'
import runGitServer from '../test-utilities/run-git-server.js'
import type {AppManifest} from './schema.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
let communityAppStoreGitServer: Awaited<ReturnType<typeof runGitServer>>

beforeAll(async () => {
	;[umbreld, communityAppStoreGitServer] = await Promise.all([createTestUmbreld(), runGitServer()])
})

afterAll(async () => {
	await Promise.all([communityAppStoreGitServer.close(), umbreld.cleanup()])
})

// The following tests are stateful and must be run in order

test.sequential('list() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.list.query()).rejects.toThrow('Invalid token')
})

test.sequential('install() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
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

test.sequential('install() installs an app', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
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

test.sequential('getBackupIgnoredPaths() returns sanitised absolute paths for installed app', async () => {
	const dataDir = umbreld.instance.dataDirectory
	const expected = ['data', 'logs', 'cache'].map((p) => path.join(dataDir, 'app-data', 'sparkles-hello-world', p))
	await expect(umbreld.client.apps.getBackupIgnoredPaths.query({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(
		expected,
	)
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

test.sequential('restart() restarts an installed app', async () => {
	await expect(umbreld.client.apps.restart.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
})

test.sequential('update() updates an installed app', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
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

test.sequential('uninstall() uninstalls an app', async () => {
	await expect(umbreld.client.apps.uninstall.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	const installedApps = await umbreld.client.apps.list.query()
})

test.sequential('list() lists no apps after uninstall', async () => {
	const installedApps = await umbreld.client.apps.list.query()
	expect(installedApps.length).toStrictEqual(0)
})
