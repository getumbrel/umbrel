import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {triggerFactoryReset} from '../test-utilities/rebooting-action.ts'

describe('Factory reset', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false

	const markerName = 'factory-reset-marker.txt'

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('creates a marker file', async () => {
		await umbreld.api.post(`files/upload?path=/Home/${markerName}`, {body: 'factory reset marker'})

		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).toContain(markerName)
	})

	test('factory resets back to registration', async () => {
		await triggerFactoryReset(umbreld.client.system.factoryReset.mutate({password: 'moneyprintergobrrr'}))

		await pWaitFor(
			async () => {
				try {
					return !(await umbreld.unauthenticatedClient.user.exists.query())
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 600_000},
		)
	})

	test('does not keep the marker file after setup', async () => {
		await umbreld.registerAndLogin()

		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).not.toContain(markerName)
	})
})
