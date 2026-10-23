import {describe, test, expect} from 'vitest'

import {isInternalStorageDisk} from './internal-storage.ts'

const size = 2 * 1024 ** 4

describe('isInternalStorageDisk', () => {
	test.each(['nvme', 'sata', 'sas'])('includes %s disks', (tran) => {
		expect(isInternalStorageDisk({type: 'disk', tran, size})).toBe(true)
	})

	test.each(['usb', 'iscsi', 'fc', 'spi', 'mmc', 'ata', 'virtio'])('excludes %s disks', (tran) => {
		expect(isInternalStorageDisk({type: 'disk', tran, size})).toBe(false)
	})

	test('excludes disks with no transport', () => {
		expect(isInternalStorageDisk({type: 'disk', tran: null, size})).toBe(false)
		expect(isInternalStorageDisk({type: 'disk', size})).toBe(false)
	})

	test.each(['part', 'rom', 'loop', 'zfs', 'enclosure'])('excludes %s block devices on internal transports', (type) => {
		expect(isInternalStorageDisk({type, tran: 'sas', size})).toBe(false)
	})

	// e.g. a SAS drive still formatted with 520 byte sectors from a storage array
	test('excludes disks the kernel attached with no capacity', () => {
		expect(isInternalStorageDisk({type: 'disk', tran: 'sas', size: 0})).toBe(false)
		expect(isInternalStorageDisk({type: 'disk', tran: 'sas'})).toBe(false)
	})
})
