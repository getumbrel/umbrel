import {describe, test, expect} from 'vitest'

import {getRaidStatusSignature} from './raid.ts'

const basePool = () => ({
	exists: true,
	status: 'ONLINE' as const,
	raidType: 'failsafe' as const,
	topology: 'mirror' as const,
	dataErrors: 0,
	devices: [
		{id: 'drive-a', status: 'ONLINE' as const},
		{id: 'drive-b', status: 'ONLINE' as const},
	],
	accelerator: {
		exists: true,
		devices: [
			{id: 'ssd-a', status: 'ONLINE' as const},
			{id: 'ssd-b', status: 'ONLINE' as const},
		],
	},
})

describe('getRaidStatusSignature', () => {
	test('identical pools produce identical signatures', () => {
		expect(getRaidStatusSignature(basePool())).toBe(getRaidStatusSignature(basePool()))
	})

	test('device enumeration order does not change the signature', () => {
		const shuffled = basePool()
		shuffled.devices.reverse()
		shuffled.accelerator.devices.reverse()
		expect(getRaidStatusSignature(shuffled)).toBe(getRaidStatusSignature(basePool()))
	})

	test('pool status change changes the signature', () => {
		const degraded = {...basePool(), status: 'DEGRADED' as const}
		expect(getRaidStatusSignature(degraded)).not.toBe(getRaidStatusSignature(basePool()))
	})

	test('pool existence change changes the signature', () => {
		expect(getRaidStatusSignature({exists: false})).not.toBe(getRaidStatusSignature(basePool()))
	})

	test('data member status change changes the signature', () => {
		const memberFailed = basePool()
		memberFailed.devices[1].status = 'FAULTED' as never
		expect(getRaidStatusSignature(memberFailed)).not.toBe(getRaidStatusSignature(basePool()))
	})

	test('data membership change changes the signature', () => {
		const memberAdded = basePool()
		memberAdded.devices.push({id: 'drive-c', status: 'ONLINE' as const})
		expect(getRaidStatusSignature(memberAdded)).not.toBe(getRaidStatusSignature(basePool()))
	})

	test('accelerator member status change changes the signature', () => {
		const acceleratorFailed = basePool()
		acceleratorFailed.accelerator.devices[0].status = 'UNAVAIL' as never
		expect(getRaidStatusSignature(acceleratorFailed)).not.toBe(getRaidStatusSignature(basePool()))
	})

	test('accelerator removal changes the signature', () => {
		const noAccelerator = {...basePool(), accelerator: {exists: false, devices: []}}
		expect(getRaidStatusSignature(noAccelerator)).not.toBe(getRaidStatusSignature(basePool()))
	})

	test('raid type and topology changes change the signature', () => {
		const storageMode = {...basePool(), raidType: 'storage' as const, topology: 'stripe' as const}
		expect(getRaidStatusSignature(storageMode)).not.toBe(getRaidStatusSignature(basePool()))
	})

	test('pool data error count change changes the signature', () => {
		const withDataErrors = {...basePool(), dataErrors: 2}
		expect(getRaidStatusSignature(withDataErrors)).not.toBe(getRaidStatusSignature(basePool()))
	})

	test('progress, space, and per-device error counters are ignored', () => {
		const withExtras = {
			...basePool(),
			rebuild: {state: 'rebuilding', progress: 50},
			usedSpace: 123,
			devices: basePool().devices.map((device) => ({...device, readErrors: 3, writeErrors: 4, checksumErrors: 5})),
		} as never
		expect(getRaidStatusSignature(withExtras)).toBe(getRaidStatusSignature(basePool()))
	})
})
