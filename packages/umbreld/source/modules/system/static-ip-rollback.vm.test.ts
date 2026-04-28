import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import got from 'got'
import pWaitFor from 'p-wait-for'
import {setTimeout as delay} from 'node:timers/promises'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

function incrementIpv4(ip: string) {
	const parts = ip.split('.').map(Number)
	parts[3] += 1
	return parts.join('.')
}

describe.sequential('Static IP rollback', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let iface:
		| {
				mac: string
				ip: string
				subnetPrefix: number
				gateway: string
				dns: string[]
		  }
		| undefined
	let ip = ''
	let downUntil = 0
	let setStaticIpResult: Promise<{success: true} | {success: false; error: unknown}> | undefined

	const requestStatus = async () => {
		// Probe the raw forwarded HTTP port instead of the tRPC client so we're
		// testing that the guest becoming unreachable is a real network effect,
		// not client-side retry/reconnect behaviour.
		return await got(`http://localhost:${umbreld.vm.httpPort}/manager-api/v1/system/update-status`, {
			retry: {limit: 0},
			timeout: {request: 1000},
			responseType: 'json',
		}).json()
	}

	const getIface = () => {
		if (!iface) throw new Error('Expected interface to be initialized')
		return iface
	}

	const getSetStaticIpResult = () => {
		if (!setStaticIpResult) throw new Error('Expected static IP mutation to be started')
		return setStaticIpResult
	}

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('applies an unconfirmed static IP and becomes unreachable', async () => {
		const networkInterface = (await umbreld.client.system.getNetworkInterfaces.query())[0]!
		iface = {
			mac: networkInterface.mac,
			ip: networkInterface.ip!,
			subnetPrefix: networkInterface.subnetPrefix!,
			gateway: networkInterface.gateway!,
			dns: networkInterface.dns!,
		}
		const currentIface = getIface()

		// Set a new static ip
		ip = incrementIpv4(currentIface.ip)
		setStaticIpResult = umbreld.client.system.setStaticIp
			.mutate({
				mac: currentIface.mac,
				ip,
				subnetPrefix: currentIface.subnetPrefix,
				gateway: currentIface.gateway,
				dns: currentIface.dns,
			})
			.then(
				() => ({success: true as const}),
				(error) => ({success: false as const, error}),
			)

		// Wait for requests to start failing so we know we're on the new ip
		await pWaitFor(
			async () => {
				try {
					await requestStatus()
					return false
				} catch {
					return true
				}
			},
			{interval: 250, timeout: 5000},
		)

		// The box should stay unreachable until the confirmation window times out.
		downUntil = Date.now() + 25_000
	})

	test('stays unreachable for the confirmation window', async () => {
		while (Date.now() < downUntil) {
			await expect(requestStatus()).rejects.toThrow()
			await delay(250)
		}
	})

	test('becomes reachable again after rollback', async () => {
		// Once the 30s confirmation timeout expires, the box should become reachable again.
		await pWaitFor(
			async () => {
				try {
					await requestStatus()
					return true
				} catch {
					return false
				}
			},
			{interval: 250, timeout: 10_000},
		)

		const result = await getSetStaticIpResult()
		expect(result.success).toBe(false)
		if (result.success) throw new Error('Expected static IP change to be rolled back')
		expect(result.error).toBeInstanceOf(Error)
		if (!(result.error instanceof Error)) throw result.error
		expect(result.error.message).toContain('not confirmed within 30 seconds')
	})

	test('returns to dhcp with no saved static config', async () => {
		// Log back in and confirm the interface is back on DHCP with no saved static config.
		await umbreld.login()
		const iface = getIface()
		const reverted = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === iface.mac)
		expect(reverted?.connected).toBe(true)
		expect(reverted?.ipMethod).toBe('dhcp')
		expect(reverted?.configuredStaticSettings).toBeUndefined()
		expect(reverted?.ip).toBe(iface.ip)
	})
})
