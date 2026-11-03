import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import Umbreld from '../../index.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'

describe('account-scoped notifications', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let umbreld: Umbreld

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		umbreld = new Umbreld({dataDirectory: await directory.create()})
		await umbreld.store.set('notifications', [])
	})

	afterEach(async () => {
		await umbreld.auth.stop()
		await directory.destroyRoot()
	})

	test('shows device notifications only to the owner and Cloud notifications only to their account', async () => {
		await umbreld.notifications.add('device-notification')
		await umbreld.notifications.addForAccount('0', 'owner-cloud-notification')
		await umbreld.notifications.addForAccount('Alice', 'member-cloud-notification')

		expect(await umbreld.notifications.getForAccount('0')).toEqual(['owner-cloud-notification', 'device-notification'])
		expect(await umbreld.notifications.getForAccount('Alice')).toEqual(['member-cloud-notification'])
		expect(await umbreld.notifications.getForAccount('Bob')).toEqual([])
	})

	test('clears one account without touching another account or device notifications', async () => {
		await umbreld.notifications.add('device-notification')
		await umbreld.notifications.addForAccount('0', 'cloud-auth:owner-account')
		await umbreld.notifications.addForAccount('Alice', 'cloud-auth:member-account')

		await umbreld.notifications.clearAccount('Alice')

		expect(await umbreld.notifications.getForAccount('Alice')).toEqual([])
		expect(await umbreld.notifications.getForAccount('0')).toEqual(['cloud-auth:owner-account', 'device-notification'])
	})

	test('lets only the owner clear a visible device notification', async () => {
		await umbreld.notifications.add('device-notification')
		await umbreld.notifications.addForAccount('Alice', 'device-notification')

		await umbreld.notifications.clearVisibleForAccount('Alice', 'device-notification')
		expect(await umbreld.notifications.get()).toEqual(['device-notification'])

		await umbreld.notifications.clearVisibleForAccount('0', 'device-notification')
		expect(await umbreld.notifications.get()).toEqual([])
	})
})
