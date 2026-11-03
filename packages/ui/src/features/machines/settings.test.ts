import {describe, expect, test} from 'vitest'

import {machineSettingsRequireShutdown, type MachineSettingsThatRequireShutdown} from './settings'

const current: MachineSettingsThatRequireShutdown = {
	cores: 2,
	memoryGb: 4,
	diskSizeGb: 40,
	firmware: 'uefi',
	diskBus: 'virtio',
}

describe('machineSettingsRequireShutdown', () => {
	test('detects every machine setting that needs a shutdown to take effect', () => {
		expect(machineSettingsRequireShutdown(current, current)).toBe(false)
		expect(machineSettingsRequireShutdown(current, {...current, cores: 4})).toBe(true)
		expect(machineSettingsRequireShutdown(current, {...current, memoryGb: 8})).toBe(true)
		expect(machineSettingsRequireShutdown(current, {...current, diskSizeGb: 80})).toBe(true)
		expect(machineSettingsRequireShutdown(current, {...current, firmware: 'bios'})).toBe(true)
		expect(machineSettingsRequireShutdown(current, {...current, diskBus: 'sata'})).toBe(true)
		expect(machineSettingsRequireShutdown(current, {...current, networkMode: 'bridged'})).toBe(true)
	})

	test('treats an omitted network mode as NAT', () => {
		expect(machineSettingsRequireShutdown(current, {...current, networkMode: 'nat'})).toBe(false)
		expect(machineSettingsRequireShutdown({...current, networkMode: 'bridged'}, current)).toBe(true)
	})

	test('treats an omitted disk bus as the default VirtIO bus', () => {
		expect(machineSettingsRequireShutdown({...current, diskBus: undefined}, current)).toBe(false)
	})
})
