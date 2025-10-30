import {setTimeout} from 'node:timers/promises'
import path from 'node:path'
import {expect, beforeAll, afterAll, test, vi} from 'vitest'
import fse from 'fs-extra'
import yaml from 'js-yaml'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'
import {BACKUP_RESTORE_FIRST_START_FLAG} from '../../constants.js'
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
	await expect(umbreld.client.apps.restart.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
})

test.sequential('update() updates an installed app', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
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

test.sequential('uninstall() uninstalls an app', async () => {
	await expect(umbreld.client.apps.uninstall.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	const installedApps = await umbreld.client.apps.list.query()
})

test.sequential('list() lists no apps after uninstall', async () => {
	const installedApps = await umbreld.client.apps.list.query()
	expect(installedApps.length).toStrictEqual(0)
})
