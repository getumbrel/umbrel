import {describe, expect, test} from 'vitest'

import {parseMdstat, parseMdadmDetail, MDADM_MIN_DEVICES} from './mdadm.js'

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
