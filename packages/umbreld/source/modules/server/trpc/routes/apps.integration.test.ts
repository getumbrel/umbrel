import {expect, beforeAll, afterAll, test} from 'vitest'

import createTestUmbreld from '../../../test-utilities/create-test-umbreld.js'
import runGitServer from '../../../test-utilities/run-git-server.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
let communityAppStoreGitServer: Awaited<ReturnType<typeof runGitServer>>

beforeAll(async () => {
	;[umbreld, communityAppStoreGitServer] = await Promise.all([createTestUmbreld(), runGitServer()])
})

afterAll(async () => {
	await Promise.all([communityAppStoreGitServer.close(), umbreld.cleanup()])
})

// The following tests are stateful and must be run in order

test('list() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.list.query()).rejects.toThrow('Invalid token')
})

test('install() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test('restart() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.restart.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test('update() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test('trackOpen() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.trackOpen.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test('login', async () => {
	await expect(umbreld.registerAndLogin()).resolves.toBe(true)
})

test('list() returns no apps when none are installed', async () => {
	const installedApps = await umbreld.client.apps.list.query()
	expect(installedApps.length).toStrictEqual(0)
})

test('install() throws error on unknown app id', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'unknown-app-id'})).rejects.toThrow('not found')
})

test('install() throws error on invalid app id', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'invalid-id-@/!'})).rejects.toThrow('Invalid')
})

test('restart() throws error on unknown app id', async () => {
	await expect(umbreld.client.apps.restart.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('not found')
})

test('update() throws error on unknown app id', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('not found')
})

test('trackOpen() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.trackOpen.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('not found')
})

test('install() installs an app', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
})

test('list() lists installed apps', async () => {
	await expect(umbreld.client.apps.list.query()).resolves.toStrictEqual([
		{
			id: 'sparkles-hello-world',
			status: {state: 'running', progress: 1},
			lastOpened: 1_705_477_545_462,
			manifest: {
				manifestVersion: 1,
				id: 'sparkles-hello-world',
				name: 'Hello World',
				tagline: "Replace this tagline with your app's tagline",
				icon: 'https://svgur.com/i/mvA.svg',
				category: 'Development',
				version: '1.0.0',
				port: 4000,
				description: "Add your app's description here.\n\nYou can also add newlines!",
				developer: 'Umbrel',
				website: 'https://umbrel.com',
				submitter: 'Umbrel',
				submission: 'https://github.com/getumbrel/umbrel-hello-world-app',
				repo: 'https://github.com/getumbrel/umbrel-hello-world-app',
				support: 'https://github.com/getumbrel/umbrel-hello-world-app/issues',
				gallery: [
					'https://i.imgur.com/yyVG0Jb.jpeg',
					'https://i.imgur.com/yyVG0Jb.jpeg',
					'https://i.imgur.com/yyVG0Jb.jpeg',
				],
				releaseNotes: "Add what's new in the latest version of your app here.",
				dependencies: [],
				path: '',
				defaultUsername: '',
				defaultPassword: '',
			},
		},
	])
})

test('restart() restarts an installed app', async () => {
	await expect(umbreld.client.apps.restart.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
})

test('update() updates an installed app', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
})

test('trackOpen() tracks an app open', async () => {
	await expect(umbreld.client.apps.update.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	// TODO: Check this actually worked
})

test('uninstall() uninstalls an app', async () => {
	await expect(umbreld.client.apps.uninstall.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)
	const installedApps = await umbreld.client.apps.list.query()
})

test('list() lists no apps after uninstall', async () => {
	const installedApps = await umbreld.client.apps.list.query()
	expect(installedApps.length).toStrictEqual(0)
})
