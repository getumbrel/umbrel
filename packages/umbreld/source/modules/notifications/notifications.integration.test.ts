import {expect, beforeAll, afterAll, test} from 'vitest'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
})

afterAll(async () => {
	await umbreld.cleanup()
})

// The following tests are stateful and must be run in order

// We sleep to allow time for fs events to be triggered and handled by the umbreld filewatcher

test.sequential('notifications.get() throws invalid error without auth token', async () => {
	await expect(umbreld.client.notifications.get.query()).rejects.toThrow('Invalid token')
})

test.sequential('login', async () => {
	await expect(umbreld.registerAndLogin()).resolves.toBe(true)
})

test.sequential('notifications.get() lists nothing on a fresh install', async () => {
	await expect(umbreld.client.notifications.get.query()).resolves.toMatchObject([])
})

test.sequential('notifications.add(notification) adds a notification', async () => {
	await umbreld.instance.notifications.add('test notification')
	await expect(umbreld.client.notifications.get.query()).resolves.toMatchObject(['test notification'])
})

test.sequential('notifications.clear(notification) clears a notification', async () => {
	await expect(umbreld.client.notifications.get.query()).resolves.toMatchObject(['test notification'])
	await umbreld.client.notifications.clear.mutate('test notification')
	await expect(umbreld.client.notifications.get.query()).resolves.toMatchObject([])
})

test.sequential('notifications.add(notification) moves duplicate notifications to front', async () => {
	// Add numbered notifications
	await umbreld.instance.notifications.add('notification-1')
	await umbreld.instance.notifications.add('notification-2')
	await umbreld.instance.notifications.add('notification-3')

	// Now add the first again to move it to the front
	await umbreld.instance.notifications.add('notification-1')

	await expect(umbreld.client.notifications.get.query()).resolves.toMatchObject([
		'notification-1',
		'notification-3',
		'notification-2',
	])
})
