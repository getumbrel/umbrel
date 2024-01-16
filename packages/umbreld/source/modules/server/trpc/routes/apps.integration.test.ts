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

test('install() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('Invalid token')
})

test('login', async () => {
	await expect(umbreld.registerAndLogin()).resolves.toBe(true)
})

test('install() throws error on unknown app id', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'unknown-app-id'})).rejects.toThrow('not found')
})

test('install() throws error on invalid app id', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'invalid-id-@/!'})).rejects.toThrow('Invalid')
})

test('install() installs an app', async () => {
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual({
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
	})
})
