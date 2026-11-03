export type MachineSettingsThatRequireShutdown = {
	cores: number
	memoryGb: number
	diskSizeGb: number
	firmware: 'uefi' | 'bios'
	diskBus?: 'virtio' | 'sata'
	networkMode?: 'nat' | 'bridged'
}

// The settings flow groups these resource and hardware fields under one clear
// post-save shutdown prompt. CPU, memory, firmware, disk-bus and network mode
// changes need a new QEMU process; storage changes join the same apply flow for
// consistency.
export function machineSettingsRequireShutdown(
	current: MachineSettingsThatRequireShutdown,
	next: MachineSettingsThatRequireShutdown,
) {
	return (
		current.cores !== next.cores ||
		current.memoryGb !== next.memoryGb ||
		current.diskSizeGb !== next.diskSizeGb ||
		current.firmware !== next.firmware ||
		(current.diskBus ?? 'virtio') !== (next.diskBus ?? 'virtio') ||
		(current.networkMode ?? 'nat') !== (next.networkMode ?? 'nat')
	)
}
