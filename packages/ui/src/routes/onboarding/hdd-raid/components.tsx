import {StorageDeviceCard} from '@/features/storage/components/storage-device-card'
import {StoragePage} from '@/features/storage/components/storage-page'

import type {StorageDevice} from '../raid/use-raid-setup'

export {StorageHeader as StepHeader} from '@/features/storage/components/storage-page'

export function FoundDeviceCard({device}: {device: StorageDevice}) {
	return <StorageDeviceCard device={device} />
}

export function ModalShell(props: React.ComponentProps<typeof StoragePage>) {
	return <StoragePage {...props} pinnedFooter />
}
