import {describeBackupLocation} from '@/features/backups/utils/backup-location-helpers'
import {useExternalStorageDevices} from '@/features/files/hooks/use-external-storage-devices'
import {useNetworkSharesQuery} from '@/features/files/hooks/use-network-shares-query'

// Describes backup locations with the names of the drives and network shares
// that are currently known
export function useDescribeBackupLocation({enabled = true}: {enabled?: boolean} = {}) {
	const {data: disks} = useExternalStorageDevices({enabled})
	const {data: shares} = useNetworkSharesQuery({enabled})
	return (path: string) => describeBackupLocation(path, {disks, shares})
}
