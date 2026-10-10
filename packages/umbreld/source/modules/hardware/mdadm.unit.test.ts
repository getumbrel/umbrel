import {describe, expect, test} from 'vitest'

import Mdadm, {
	parseMdstat,
	parseMdadmDetail,
	MDADM_MIN_DEVICES,
	MDADM_FILESYSTEMS,
	allocateNextMdDevice,
	isValidMdDevice,
	isMdadmFilesystem,
	mdadmMountName,
} from './mdadm.js'

describe('mdadm mdstat parser', () => {
	test('parses clean active array', () => {
		const mdstat = `Personalities : [raid1]
md0 : active raid1 sda1[0] sdb1[1]
      976630272 blocks super 1.2 [2/2] [UU]
`
		const arrays = parseMdstat(mdstat)
		expect(arrays).toHaveLength(1)
		expect(arrays[0].device).toBe('/dev/md0')
		expect(arrays[0].level).toBe('1')
	})

	test('parses degraded array', () => {
		const mdstat = `Personalities : [raid1]
md0 : active raid1 sda1[0]
      976630272 blocks super 1.2 [2/1] [U_]
`
		const arrays = parseMdstat(mdstat)
		expect(arrays[0].state).toBe('degraded')
	})

	test('parses resync progress', () => {
		const mdstat = `Personalities : [raid1]
md0 : active raid1 sdb1[1] sda1[0]
      976630272 blocks super 1.2 [2/2] [UU]
      [===>.................]  resync = 15.2% (148456192/976630272) finish=120.5min speed=114318K/sec
`
		const arrays = parseMdstat(mdstat)
		expect(arrays[0].syncAction).toBe('resync')
		expect(arrays[0].syncProgress).toBeCloseTo(15.2)
		expect(arrays[0].state).toBe('resync')
	})

	test('returns empty when no arrays', () => {
		expect(parseMdstat('Personalities : [raid1]\nunused devices: <none>\n')).toHaveLength(0)
	})

	test('flags a failed member as degraded even without active counts', () => {
		const mdstat = `Personalities : [raid1]
md0 : active raid1 sda1[0](F) sdb1[1]
      976630272 blocks super 1.2
`
		const arrays = parseMdstat(mdstat)
		expect(arrays[0].state).toBe('degraded')
	})
})

describe('mdadm array mount names', () => {
	test('prefers the array name over the device node', () => {
		expect(mdadmMountName('/dev/md0', 'umbrel-md')).toBe('umbrel-md')
	})

	test('falls back to the device node when the name is blank', () => {
		expect(mdadmMountName('/dev/md2')).toBe('md2')
		expect(mdadmMountName('/dev/md2', '')).toBe('md2')
		expect(mdadmMountName('/dev/md2', '   ')).toBe('md2')
	})

	test('strips a homehost prefix from metadata 1.2 names', () => {
		expect(mdadmMountName('/dev/md0', 'umbrel:media')).toBe('media')
	})

	test('sanitises characters that are unsafe in a path segment', () => {
		expect(mdadmMountName('/dev/md0', 'my raid/array')).toBe('my_raid_array')
		expect(mdadmMountName('/dev/md0', '..hidden')).toBe('hidden')
	})
})

describe('mdadm detail parser', () => {
	test('parses RAID1 detail', () => {
		const detail = `/dev/md0:
        Version : 1.2
     Raid Level : raid1
     Array Size : 976630272 (931.39 GiB 1000.07 GB)
  Used Dev Size : 976630272 (931.39 GiB 1000.07 GB)
   Raid Devices : 2
  Total Devices : 2
    Active Devices : 2
   Working Devices : 2
    Failed Devices : 0
     Spare Devices : 0
            State : clean
             Name : umbrel-md
             UUID : abc123:def456
`
		const parsed = parseMdadmDetail(detail)
		expect(parsed.level).toBe('1')
		expect(parsed.raidDevices).toBe(2)
		expect(parsed.state).toBe('clean')
		expect(parsed.name).toBe('umbrel-md')
	})

	test('classifies "clean, degraded" as degraded, not clean', () => {
		const detail = `/dev/md0:
     Raid Level : raid1
   Raid Devices : 2
            State : clean, degraded
             Name : umbrel-md
`
		expect(parseMdadmDetail(detail).state).toBe('degraded')
	})
})

describe('mdadm level requirements', () => {
	test('minimum device counts', () => {
		expect(MDADM_MIN_DEVICES['0']).toBe(2)
		expect(MDADM_MIN_DEVICES['1']).toBe(2)
		expect(MDADM_MIN_DEVICES['5']).toBe(3)
		expect(MDADM_MIN_DEVICES['6']).toBe(4)
		expect(MDADM_MIN_DEVICES['10']).toBe(4)
	})
})

describe('mdadm multi-array allocation', () => {
	test('validates md device paths', () => {
		expect(isValidMdDevice('/dev/md0')).toBe(true)
		expect(isValidMdDevice('/dev/md31')).toBe(true)
		expect(isValidMdDevice('/dev/mdA')).toBe(false)
		expect(isValidMdDevice('/dev/sda1')).toBe(false)
	})

	test('allocates first free slot', () => {
		expect(allocateNextMdDevice([])).toBe('/dev/md0')
		expect(allocateNextMdDevice(['/dev/md0'])).toBe('/dev/md1')
		expect(allocateNextMdDevice(['/dev/md0', '/dev/md1', '/dev/md3'])).toBe('/dev/md2')
	})

	test('parses multiple arrays', () => {
		const mdstat = `Personalities : [raid1] [raid5]
md0 : active raid1 sda1[0] sdb1[1]
      976630272 blocks super 1.2 [2/2] [UU]
md1 : active raid5 sdc1[0] sdd1[1] sde1[2]
      1953260544 blocks super 1.2 level 5, 512k chunk, algorithm 2 [3/3] [UUU]
`
		const arrays = parseMdstat(mdstat)
		expect(arrays).toHaveLength(2)
		expect(arrays.map((a) => a.device)).toEqual(['/dev/md0', '/dev/md1'])
	})

	test('parses reshape progress', () => {
		const mdstat = `Personalities : [raid6]
md1 : active raid6 sdc1[0] sdd1[1] sde1[2] sdf1[3]
      1953260544 blocks super 1.2 level 6 [4/4] [UUUU]
      [====>................]  reshape = 22.5% (219888128/976630272) finish=45.2min speed=279123K/sec
`
		const arrays = parseMdstat(mdstat)
		expect(arrays[0].syncAction).toBe('reshape')
		expect(arrays[0].syncProgress).toBeCloseTo(22.5)
		expect(arrays[0].state).toBe('resync')
	})
})

describe('mdadm filesystems', () => {
	test('catalogues every supported filesystem', () => {
		const values = Object.keys(MDADM_FILESYSTEMS)
		expect(values).toEqual(['ext4', 'btrfs', 'xfs', 'exfat', 'vfat', 'ntfs'])
		expect(MDADM_FILESYSTEMS.ext4.native).toBe(true)
		expect(MDADM_FILESYSTEMS.btrfs.native).toBe(true)
		expect(MDADM_FILESYSTEMS.xfs.native).toBe(true)
		// Synthetic-ownership filesystems cannot store Linux permissions
		expect(MDADM_FILESYSTEMS.exfat.native).toBe(false)
		expect(MDADM_FILESYSTEMS.vfat.native).toBe(false)
		expect(MDADM_FILESYSTEMS.ntfs.native).toBe(false)
	})

	test('rejects unsupported filesystems', () => {
		expect(isMdadmFilesystem('ext4')).toBe(true)
		expect(isMdadmFilesystem('zfs')).toBe(false)
		expect(isMdadmFilesystem('cramfs')).toBe(false)
	})

	test('every filesystem has an mkfs tool', () => {
		for (const [value, meta] of Object.entries(MDADM_FILESYSTEMS)) {
			expect(meta.tool.startsWith(`mkfs.`), `${value} -> ${meta.tool}`).toBe(true)
		}
	})

	test('every filesystem declares a label limit', () => {
		for (const [value, meta] of Object.entries(MDADM_FILESYSTEMS)) {
			expect(Number.isInteger(meta.labelMax), value).toBe(true)
			expect(meta.labelMax, value).toBeGreaterThan(0)
		}
		// FAT-family labels are the tight ones (11 chars, the 8.3 volume label)
		expect(MDADM_FILESYSTEMS.vfat.labelMax).toBe(11)
		expect(MDADM_FILESYSTEMS.exfat.labelMax).toBe(11)
	})

	test('mkfs args match each tool contract', () => {
		// ext4/btrfs/xfs/ntfs take a label via -L, exfat via -n, vfat via -n and -F
		expect(Mdadm.MKFS_ARGS.ext4('data')[0]).toBe('mkfs.ext4')
		expect(Mdadm.MKFS_ARGS.ext4('data')).toContain('-L')
		expect(Mdadm.MKFS_ARGS.btrfs('data')).toContain('-f')
		expect(Mdadm.MKFS_ARGS.xfs('data')).toContain('-f')
		expect(Mdadm.MKFS_ARGS.exfat('data')).toContain('-n')
		expect(Mdadm.MKFS_ARGS.vfat('data')).toContain('-F')
		expect(Mdadm.MKFS_ARGS.ntfs('data')).toContain('-f')
		// Every variant ends with the label
		for (const [value, build] of Object.entries(Mdadm.MKFS_ARGS)) {
			expect(build('data').at(-1), value).toBe('data')
		}
	})
})
