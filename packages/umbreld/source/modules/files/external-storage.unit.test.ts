import {describe, expect, test} from 'vitest'

import {
	isAutoMountableFilesystem,
	isEligibleExternalStorageDevice,
	supportsAppDataRootFilesystem,
	syntheticOwnershipMountOptions,
} from './external-storage.ts'

describe('isEligibleExternalStorageDevice', () => {
	test('excludes USB devices that report zero capacity', () => {
		expect(isEligibleExternalStorageDevice({id: 'sdb', transport: 'usb', size: 0}, new Set())).toBe(false)
	})

	test('keeps blank USB disks that report usable capacity', () => {
		expect(isEligibleExternalStorageDevice({id: 'sdb', transport: 'usb', size: 1_000_204_886_016}, new Set())).toBe(
			true,
		)
	})
})

describe('isAutoMountableFilesystem', () => {
	test.each(['ext2', 'ext3', 'ext4', 'btrfs', 'xfs', 'vfat', 'exfat', 'ntfs', 'EXFAT'])(
		'auto-mounts %s',
		(filesystem) => {
			expect(isAutoMountableFilesystem(filesystem)).toBe(true)
		},
	)

	test.each([
		'hfsplus',
		'hfs',
		'minix',
		'nilfs2',
		'ufs',
		'jfs',
		'f2fs',
		'iso9660',
		'udf',
		'crypto_LUKS',
		'unknown',
		'',
	])('does not auto-mount %s', (filesystem) => {
		expect(isAutoMountableFilesystem(filesystem)).toBe(false)
	})
})

describe('syntheticOwnershipMountOptions', () => {
	test.each(['exfat', 'vfat', 'ntfs', 'ntfs3', 'EXFAT'])('shares %s mounts with the Files group', (filesystem) => {
		expect(syntheticOwnershipMountOptions(filesystem, 1000, 1000)).toBe('uid=1000,gid=1000,fmask=0007,dmask=0007')
	})

	test.each(['ext4', 'xfs', 'btrfs', 'unknown'])('preserves native ownership for %s', (filesystem) => {
		expect(syntheticOwnershipMountOptions(filesystem, 1000, 1000)).toBeUndefined()
	})
})

describe('supportsAppDataRootFilesystem', () => {
	test.each(['ext4', 'EXT4'])('supports %s', (filesystem) => {
		expect(supportsAppDataRootFilesystem(filesystem)).toBe(true)
	})

	test.each(['exfat', 'vfat', 'ntfs', 'ntfs3', 'xfs', 'btrfs', 'unknown'])('rejects %s', (filesystem) => {
		expect(supportsAppDataRootFilesystem(filesystem)).toBe(false)
	})
})
