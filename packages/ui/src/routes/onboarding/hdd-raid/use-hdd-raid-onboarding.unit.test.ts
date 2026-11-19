import assert from 'node:assert/strict'
import test from 'node:test'

import type {StorageDevice} from '../raid/use-raid-setup.ts'
import {getCandidates} from './use-hdd-raid-onboarding.ts'

const TB = 1_000_000_000_000

function device(overrides: {
	id?: string
	type?: 'hdd' | 'ssd'
	roundedSize?: number
	isSystemDrive?: boolean
}): StorageDevice {
	return {
		id: 'MODEL_SERIAL',
		type: 'hdd',
		roundedSize: 6 * TB,
		size: 6 * TB,
		isSystemDrive: false,
		...overrides,
	} as unknown as StorageDevice
}

const ids = (devices: StorageDevice[]) => devices.map((d) => d.id)

test('getCandidates excludes system drives and devices without an id', () => {
	const {hdds, ssds} = getCandidates([
		device({id: 'HDD_A'}),
		device({id: 'SSD_A', type: 'ssd'}),
		device({id: 'BOOT_DRIVE', type: 'ssd', isSystemDrive: true}),
		device({id: undefined}),
	])
	assert.deepEqual(ids(hdds), ['HDD_A'])
	assert.deepEqual(ids(ssds), ['SSD_A'])
})
