import type {StorageConfig} from '@/features/storage/model'
import type {AccountCredentials} from '@/routes/onboarding/create-account'

import type {StorageSummary} from '../raid/create-storage'
import type {StorageDevice} from '../raid/use-raid-setup'

// What the storage step hands to /onboarding/hdd-raid/setup via location.state: the account,
// the storage that was chosen, and what to say about it on the launch screen
export type HddRaidSetupState = {
	credentials: AccountCredentials
	config: StorageConfig
	summary?: StorageSummary
}

// Split eligible (non-system, identifiable) devices by kind. Storage is one kind of drive,
// and SSDs beside hard drives can accelerate them.
export function getCandidates(devices: StorageDevice[]) {
	const eligible = devices.filter((device) => !device.isSystemDrive && device.id)
	return {
		hdds: eligible.filter((device) => device.type === 'hdd'),
		ssds: eligible.filter((device) => device.type === 'ssd'),
	}
}
