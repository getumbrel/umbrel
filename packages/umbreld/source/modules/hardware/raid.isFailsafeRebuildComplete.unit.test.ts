import {describe, expect, test} from 'vitest'

import {isFailsafeRebuildComplete} from './raid.ts'

describe('isFailsafeRebuildComplete', () => {
	const onlineDevice = {status: 'ONLINE' as const}

	test('accepts the explicit finished rebuild state', () => {
		expect(
			isFailsafeRebuildComplete({
				rebuild: {state: 'finished', progress: 100},
			}),
		).toBe(true)
	})

	test('accepts the healthy postcondition when the rebuild finished before the first poll', () => {
		expect(
			isFailsafeRebuildComplete({
				raidType: 'failsafe',
				status: 'ONLINE',
				devices: [onlineDevice, onlineDevice],
			}),
		).toBe(true)
	})

	test('rejects incomplete or unhealthy states', () => {
		expect(
			isFailsafeRebuildComplete({
				raidType: 'failsafe',
				status: 'ONLINE',
				devices: [onlineDevice],
			}),
		).toBe(false)
		expect(
			isFailsafeRebuildComplete({
				raidType: 'failsafe',
				status: 'DEGRADED',
				devices: [onlineDevice, {status: 'DEGRADED'}],
			}),
		).toBe(false)
		expect(
			isFailsafeRebuildComplete({
				raidType: 'failsafe',
				status: 'ONLINE',
				devices: [onlineDevice, onlineDevice],
				rebuild: {state: 'rebuilding', progress: 99},
			}),
		).toBe(false)
		expect(
			isFailsafeRebuildComplete({
				raidType: 'failsafe',
				status: 'ONLINE',
				devices: [onlineDevice, onlineDevice],
				rebuild: {state: 'canceled', progress: 0},
			}),
		).toBe(false)
	})
})
