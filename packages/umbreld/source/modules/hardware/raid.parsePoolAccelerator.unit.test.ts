import {describe, expect, test} from 'vitest'

import {parsePoolAccelerator} from './raid.ts'

type PoolInput = Parameters<typeof parsePoolAccelerator>[0]
type VdevInput = PoolInput['vdevs'][string]

function vdev(overrides: Partial<VdevInput>): VdevInput {
	return {
		vdev_type: 'disk',
		name: 'disk',
		guid: 1,
		class: 'l2cache',
		state: 'ONLINE',
		alloc_space: 0,
		total_space: 0,
		def_space: 0,
		read_errors: 0,
		write_errors: 0,
		checksum_errors: 0,
		...overrides,
	}
}

describe('parsePoolAccelerator', () => {
	test('combines cache and special partitions into one physical SSD with summed errors', () => {
		const accelerator = parsePoolAccelerator({
			vdevs: {
				cacheA: vdev({
					name: 'cache-a',
					class: 'l2cache',
					path: '/dev/disk/by-umbrel-id/ACCEL_A-part2',
					phys_space: 100,
					read_errors: 1,
					write_errors: 2,
					checksum_errors: 3,
				}),
				specialA: vdev({
					name: 'special-a',
					class: 'special',
					path: '/dev/disk/by-umbrel-id/ACCEL_A-part3',
					phys_space: 200,
					state: 'FAULTED',
					read_errors: 4,
					write_errors: 5,
					checksum_errors: 6,
				}),
				cacheB: vdev({
					name: 'cache-b',
					class: 'l2cache',
					path: '/dev/disk/by-umbrel-id/ACCEL_B-part2',
					phys_space: 50,
				}),
				specialB: vdev({
					name: 'special-b',
					class: 'special',
					path: '/dev/disk/by-umbrel-id/ACCEL_B-part3',
					phys_space: 150,
				}),
				// An incomplete physical accelerator is not exposed as a usable member.
				unmatchedCache: vdev({
					name: 'cache-c',
					class: 'l2cache',
					path: '/dev/disk/by-umbrel-id/ACCEL_C-part2',
				}),
			},
		})

		expect(accelerator.devices).toHaveLength(2)
		expect(accelerator.devices[0]).toMatchObject({
			id: 'ACCEL_A',
			status: 'FAULTED',
			readErrors: 5,
			writeErrors: 7,
			checksumErrors: 9,
			l2arcSize: 100,
			specialSize: 200,
		})
		expect(accelerator.totalL2arcSize).toBe(150)
		expect(accelerator.totalSpecialUsableSize).toBe(150)
	})
})
