import {setTimeout} from 'node:timers/promises'
import path from 'node:path'
import {expect, beforeAll, afterAll, test, vi} from 'vitest'
import fse from 'fs-extra'
import yaml from 'js-yaml'
import {$} from 'execa'

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

test.sequential('update() removes the old image when a mutable reference is re-pointed', async () => {
	// Simulate a stale local image for the app's mutable image reference by pointing
	// the tag at a different image, like the state after the tag has been re-pushed
	// upstream. Before the update the tag resolves to the stale image, after the
	// update's pull it resolves to the new image which previously orphaned the stale
	// image as an untagged leak.
	const app = umbreld.instance.apps.getApp('sparkles-hello-world')
	const [imageReference] = await app.readComposeImages()
	await $`docker pull busybox:1.36.0`
	await $`docker tag busybox:1.36.0 ${imageReference}`
	const {stdout: staleImageId} = await $`docker image inspect --format {{.Id}} ${imageReference}`
	await $`docker rmi busybox:1.36.0`

	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)

	// The stale image should have been removed and the app's real image should remain
	await expect($`docker image inspect ${staleImageId}`).rejects.toThrow()
	const {stdout: currentImageId} = await $`docker image inspect --format {{.Id}} ${imageReference}`
	expect(currentImageId).not.toBe(staleImageId)
})

test.sequential('update() applies a new app version from the app store', async () => {
	// Add a busybox sidecar service to the app's compose file in the app store and
	// bump the version, like a real app update. Note the app store repo umbreld
	// installs from is the git server created by createTestUmbreld, not the
	// separate community app store git server used by other tests.
	const appDirectory = path.join(umbreld.gitServer.directory, 'sparkles-hello-world')
	const manifestPath = path.join(appDirectory, 'umbrel-app.yml')
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	manifest.version = '1.0.1'
	await fse.writeFile(manifestPath, yaml.dump(manifest))
	const composePath = path.join(appDirectory, 'docker-compose.yml')
	const compose = yaml.load(await fse.readFile(composePath, 'utf8')) as any
	compose.services.sidecar = {image: 'busybox:1.36.1', command: 'sleep infinity'}
	await fse.writeFile(composePath, yaml.dump(compose))
	const $$ = $({cwd: umbreld.gitServer.directory})
	await $$`git add .`
	await $$`git commit -m ${'Update sparkles-hello-world to 1.0.1'}`

	// Refresh the local app store and update the app
	await umbreld.instance.appStore.update()
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)

	// The app should now run the updated compose file including the new service
	const app = umbreld.instance.apps.getApp('sparkles-hello-world')
	await expect(app.readComposeImages()).resolves.toContain('busybox:1.36.1')
})

test.sequential('cleanOrphanedImages() removes orphaned app images and nothing else', async () => {
	// Create an orphaned image of a managed repository: pull an old busybox by tag,
	// then remove the tag and re-pull by digest so the image has a repo digest but
	// no tags, like an image leaked by an interrupted app update. busybox is a
	// managed repository because the app's compose file now includes it.
	const repoDigestsFormat = '{{index .RepoDigests 0}}'
	await $`docker pull busybox:1.35.0`
	const {stdout: managedDigest} = await $`docker image inspect --format ${repoDigestsFormat} busybox:1.35.0`
	const {stdout: orphanedImageId} = await $`docker image inspect --format {{.Id}} busybox:1.35.0`
	await $`docker rmi busybox:1.35.0`
	await $`docker pull ${managedDigest}`

	// Create images that must all survive the sweep: an orphaned image of a
	// repository umbrel doesn't manage, a tagged image and a locally built image
	await $`docker pull alpine:3.19`
	const {stdout: unmanagedDigest} = await $`docker image inspect --format ${repoDigestsFormat} alpine:3.19`
	const {stdout: unmanagedImageId} = await $`docker image inspect --format {{.Id}} alpine:3.19`
	await $`docker rmi alpine:3.19`
	await $`docker pull ${unmanagedDigest}`
	await $`docker pull busybox:1.37.0`
	const {stdout: locallyBuiltImageId} = await $({
		input: 'FROM busybox:1.37.0\nLABEL umbrel-test-locally-built=true',
	})`docker build --quiet -`

	try {
		await umbreld.instance.apps.cleanOrphanedImages()

		// The orphaned image of the managed repository should have been removed
		await expect($`docker image inspect ${orphanedImageId}`).rejects.toThrow()
		// The unmanaged orphan, the tagged image, the locally built image and the
		// installed app's images all survive
		await expect($`docker image inspect ${unmanagedImageId}`).resolves.toBeTruthy()
		await expect($`docker image inspect busybox:1.37.0`).resolves.toBeTruthy()
		await expect($`docker image inspect ${locallyBuiltImageId}`).resolves.toBeTruthy()
		const app = umbreld.instance.apps.getApp('sparkles-hello-world')
		for (const imageReference of await app.readComposeImages()) {
			await expect($`docker image inspect ${imageReference}`).resolves.toBeTruthy()
		}
	} finally {
		// Clean up the test images
		await $`docker rmi ${unmanagedImageId}`.catch(() => {})
		await $`docker rmi ${locallyBuiltImageId}`.catch(() => {})
		await $`docker rmi busybox:1.37.0`.catch(() => {})
	}
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
