import assert from 'node:assert/strict'
import test from 'node:test'

import type {RaidStatus, StorageDevice} from './hooks/use-storage.ts'
import {formatStorageSize, getPoolDeviceType} from './utils.ts'

function device(overrides: {id?: string; type?: 'hdd' | 'ssd'}): StorageDevice {
	return {id: 'MODEL_SERIAL', type: 'hdd', isSystemDrive: false, ...overrides} as unknown as StorageDevice
}

const member = (id: string, status = 'ONLINE') => ({id, status, readErrors: 0, writeErrors: 0, checksumErrors: 0})

test('getPoolDeviceType reads the kind of drive from any member that is attached', () => {
	const pool = {exists: true, devices: [member('POOL')]} as RaidStatus

	assert.equal(getPoolDeviceType(pool, [device({id: 'POOL', type: 'ssd'})]), 'ssd')
	assert.equal(getPoolDeviceType(pool, [device({id: 'POOL', type: 'hdd'})]), 'hdd')
})

test('getPoolDeviceType only names a kind for detached members where the layout allows one', () => {
	const detached = {exists: true, devices: [member('MISSING', 'UNAVAIL')]} as RaidStatus

	// Only hard drives are mirrored in pairs, protected against two failures, or accelerated
	assert.equal(getPoolDeviceType({...detached, topology: 'mirror'}, []), 'hdd')
	assert.equal(getPoolDeviceType({...detached, topology: 'raidz', raidzParity: 2}, []), 'hdd')
	assert.equal(
		getPoolDeviceType({...detached, topology: 'stripe', accelerator: {exists: true}} as RaidStatus, []),
		'hdd',
	)
	// One-drive protection and unprotected storage are open to SSDs and hard drives alike
	assert.equal(getPoolDeviceType({...detached, topology: 'raidz', raidzParity: 1}, []), undefined)
	assert.equal(getPoolDeviceType({...detached, topology: 'stripe'}, []), undefined)
	assert.equal(getPoolDeviceType({name: 'umbrel', exists: false}, []), undefined)
})

test('formatStorageSize keeps one decimal below 100 and none above', () => {
	assert.equal(formatStorageSize(4_500_000_000_000), '4.5TB')
	assert.equal(formatStorageSize(45_240_000_000), '45.2GB')
	assert.equal(formatStorageSize(256_100_000_000), '256GB')
})

test('formatStorageSize moves up a unit instead of showing four digits', () => {
	assert.equal(formatStorageSize(999_600_000_000), '1TB')
	assert.equal(formatStorageSize(999_400_000_000), '999GB')
})
