import {useState} from 'react'

import {StorageDevice} from './use-raid-setup'

// Opens Storage Manager's health dialog from onboarding and the RAID error page. These screens can
// list drives that have no id, so this keeps the device the dialog was opened with, where Storage
// Manager's own hook keeps an id and looks the device up again
export function useSsdHealthDialog() {
	const [selectedDevice, setSelectedDevice] = useState<{device: StorageDevice; slotNumber?: number} | null>(null)

	return {
		selectedDevice,
		open: selectedDevice !== null,
		onOpenChange: (open: boolean) => {
			if (!open) setSelectedDevice(null)
		},
		openDialog: (device: StorageDevice, slotNumber?: number) => {
			setSelectedDevice({device, slotNumber})
		},
	}
}
