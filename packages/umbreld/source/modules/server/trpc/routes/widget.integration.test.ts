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

test('listAll() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.widget.listAll.query()).rejects.toThrow('Invalid token')
})

test('enabled() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.widget.enabled.query()).rejects.toThrow('Invalid token')
})

test('enable() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.widget.enable.mutate({widgetId: 'umbrel:storage'})).rejects.toThrow('Invalid token')
})

test('disable() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.widget.disable.mutate({widgetId: 'umbrel:storage'})).rejects.toThrow('Invalid token')
})

test('data() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.widget.data.query({widgetId: 'umbrel:storage'})).rejects.toThrow('Invalid token')
})

test('login', async () => {
	await expect(umbreld.registerAndLogin()).resolves.toBe(true)
})

test('listAll() returns available widgets', async () => {
	await expect(umbreld.client.widget.listAll.query()).resolves.toStrictEqual([
		{
			id: 'umbrel:storage',
			type: 'stat-with-progress',
			refresh: 1000 * 60 * 5,
			example: {
				title: 'Storage',
				value: '256 GB',
				progressLabel: '1.75 TB left',
				progress: 0.25,
			},
		},
		{
			id: 'umbrel:memory',
			type: 'stat-with-progress',
			refresh: 1000 * 10,
			example: {
				title: 'Memory',
				value: '5.8 GB',
				subValue: '/16GB',
				progressLabel: '11.4 GB left',
				progress: 0.36,
			},
		},
	])
})

test('enabled() returns no widgets when none are enabled', async () => {
	await expect(umbreld.client.widget.enabled.query()).resolves.toStrictEqual([])
})

test('enable() enables a widget', async () => {
	await expect(umbreld.client.widget.enable.mutate({widgetId: 'umbrel:storage'})).resolves.toStrictEqual(true)
})

test('enabled() returns enabled widgets', async () => {
	await expect(umbreld.client.widget.enabled.query()).resolves.toStrictEqual([
		{
			id: 'umbrel:storage',
			type: 'stat-with-progress',
			refresh: 1000 * 60 * 5,
			example: {
				title: 'Storage',
				value: '256 GB',
				progressLabel: '1.75 TB left',
				progress: 0.25,
			},
		},
	])
})

test('data() returns live widget data', async () => {
	await expect(umbreld.client.widget.data.query({widgetId: 'umbrel:storage'})).resolves.toStrictEqual({
		id: 'umbrel:storage',
		type: 'stat-with-progress',
		refresh: 1000 * 60 * 5,
		data: {
			title: 'Storage',
			value: '256 GB',
			progressLabel: '1.75 TB left',
			progress: 0.25,
		},
	})
})

test('disable() disables a widget', async () => {
	await expect(umbreld.client.widget.disable.mutate({widgetId: 'umbrel:storage'})).resolves.toStrictEqual(true)
})

test('enabled() returns no widgets when they are all disabled', async () => {
	await expect(umbreld.client.widget.enabled.query()).resolves.toStrictEqual([])
})
