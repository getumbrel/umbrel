import {describe, test, expect} from 'vitest'

import {resolveSystemDiskNames} from './internal-storage.ts'

const blockDevices = [
	{name: 'nvme0n1', pkname: null, type: 'disk'},
	{name: 'nvme0n1p1', pkname: 'nvme0n1', type: 'part'},
	{name: 'nvme0n1p2', pkname: 'nvme0n1', type: 'part'},
	{name: 'sda', pkname: null, type: 'disk'},
	{name: 'sda1', pkname: 'sda', type: 'part'},
]

describe('resolveSystemDiskNames', () => {
	test('resolves a partition source to its parent disk', () => {
		expect(resolveSystemDiskNames(['/dev/nvme0n1p2'], blockDevices)).toEqual(new Set(['nvme0n1']))
	})

	test('resolves a whole-disk source to itself', () => {
		expect(resolveSystemDiskNames(['/dev/sda'], blockDevices)).toEqual(new Set(['sda']))
	})

	test('collects disks across multiple sources and dedupes', () => {
		expect(resolveSystemDiskNames(['/dev/nvme0n1p1', '/dev/nvme0n1p2', '/dev/sda1'], blockDevices)).toEqual(
			new Set(['nvme0n1', 'sda']),
		)
	})

	test('resolves stacked block devices through every parent level', () => {
		const stackedBlockDevices = [
			...blockDevices,
			{name: 'nvme0n1p3', pkname: 'nvme0n1', type: 'part'},
			{name: 'dm-0', pkname: 'nvme0n1p3', type: 'crypt'},
		]
		expect(resolveSystemDiskNames(['/dev/dm-0'], stackedBlockDevices)).toEqual(new Set(['nvme0n1']))
	})

	test('resolves every physical disk beneath a multi-device system volume', () => {
		const mirroredBlockDevices = [
			...blockDevices,
			{name: 'sdb', pkname: null, type: 'disk'},
			{name: 'sdb1', pkname: 'sdb', type: 'part'},
			{name: 'md0', pkname: 'sda1', type: 'raid1'},
			{name: 'md0', pkname: 'sdb1', type: 'raid1'},
		]
		expect(resolveSystemDiskNames(['/dev/md0'], mirroredBlockDevices)).toEqual(new Set(['sda', 'sdb']))
	})

	test('allows non-device sources when another system path resolves', () => {
		expect(resolveSystemDiskNames(['umbrelos-df2f7bce/data', 'overlay', '/dev/nvme0n1p1'], blockDevices)).toEqual(
			new Set(['nvme0n1']),
		)
	})

	test('uses the Rugix config partition when root is an overlay and data is on ZFS', () => {
		expect(resolveSystemDiskNames(['overlay', '/dev/sda1', 'umbrelos-df2f7bce/data'], blockDevices)).toEqual(
			new Set(['sda']),
		)
	})

	test('fails closed when no system path resolves to a physical disk', () => {
		expect(() => resolveSystemDiskNames(['umbrelos-df2f7bce/data', 'overlay', undefined], blockDevices)).toThrow(
			'Could not determine the physical disk backing the running system',
		)
	})

	test('fails closed when a /dev source cannot be resolved', () => {
		expect(() => resolveSystemDiskNames(['/dev/dm-0', '/dev/nvme0n1p1'], blockDevices)).toThrow(
			'Could not resolve system block device /dev/dm-0',
		)
	})
})
