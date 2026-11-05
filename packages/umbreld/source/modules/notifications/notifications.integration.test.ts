import {expect, beforeAll, afterAll, test} from 'vitest'

import createTestUmbreld from '../test-utilities/create-test-umbreld.ts'

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

test.sequential('notifications.get() lists only the onboarding notification on a fresh install', async () => {
	await expect(umbreld.client.notifications.get.query()).resolves.toMatchObject(['onboarding-complete'])
})

test.sequential('notifications.clear(notification) clears the onboarding notification', async () => {
	await umbreld.client.notifications.clear.mutate('onboarding-complete')
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

test.sequential('account-scoped notifications are private and independently clearable', async () => {
	const memberPassword = 'member-password'
	const member = await umbreld.client.user.createUser.mutate({name: 'Alice', password: memberPassword})
	await umbreld.instance.notifications.add('device-notification')
	await umbreld.instance.notifications.addForAccount('0', 'owner-cloud-notification')
	await umbreld.instance.notifications.addForAccount(member.userId, 'member-cloud-notification')

	const ownerNotifications = await umbreld.client.notifications.get.query()
	expect(ownerNotifications).toEqual(expect.arrayContaining(['device-notification', 'owner-cloud-notification']))
	expect(ownerNotifications).not.toContain('member-cloud-notification')

	const memberToken = await umbreld.client.user.login.mutate({
		userId: member.userId,
		password: memberPassword,
	})
	umbreld.setAuthToken(memberToken)
	// A new member starts with their own scoped onboarding notification
	await expect(umbreld.client.notifications.get.query()).resolves.toEqual([
		'member-cloud-notification',
		'onboarding-complete',
	])
	await expect(umbreld.client.notifications.clear.mutate('member-cloud-notification')).resolves.toBe(true)
	await expect(umbreld.client.notifications.clear.mutate('onboarding-complete')).resolves.toBe(true)
	await expect(umbreld.client.notifications.get.query()).resolves.toEqual([])

	const ownerToken = await umbreld.client.user.login.mutate({
		userId: '0',
		password: 'moneyprintergobrrr',
	})
	umbreld.setAuthToken(ownerToken)
	const ownerNotificationsAfterMemberClear = await umbreld.client.notifications.get.query()
	expect(ownerNotificationsAfterMemberClear).toEqual(
		expect.arrayContaining(['device-notification', 'owner-cloud-notification']),
	)
	expect(await umbreld.instance.notifications.get()).not.toEqual(
		expect.arrayContaining([expect.stringContaining('member-cloud-notification')]),
	)
})
