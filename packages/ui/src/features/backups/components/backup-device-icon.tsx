import {getDeviceType} from '@/features/backups/utils/backup-location-helpers'
import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import activeNasIcon from '@/features/files/assets/nas-icon-active.png'
import umbrelDeviceActive from '@/features/files/assets/umbrel-device-icon-active.png'
import {useNetworkDeviceType} from '@/features/files/hooks/use-network-device-type'
import {t} from '@/utils/i18n'

export function BackupDeviceIcon({path, className = ''}: {path: string; className?: string}) {
	const kind = getDeviceType(path)
	const {deviceType} = useNetworkDeviceType(path)

	if (kind === 'NAS') {
		// Show Umbrel Home icon if detected as Umbrel device
		if (deviceType === 'umbrel') {
			return <img src={umbrelDeviceActive} alt={t('umbrel')} className={className} draggable={false} />
		}
		// Otherwise show generic NAS icon
		return <img src={activeNasIcon} alt={t('nas')} className={className} draggable={false} />
	}

	return <img src={externalStorageIcon} alt={t('external-drive')} className={className} draggable={false} />
}
