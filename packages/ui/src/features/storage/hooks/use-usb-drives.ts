import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {useExternalStorageDevices} from '@/features/files/hooks/use-external-storage-devices'

import type {UsbDrivesProps} from '../manager/shared'

// The USB drives Storage Manager lists, named the way Files names them
export function useUsbDrives(): UsbDrivesProps {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const devicesQ = useExternalStorageDevices()
	const drives = (devicesQ.data ?? []).map((drive) => {
		const mounted = drive.partitions.filter((partition) => partition.mountpoints.length > 0)
		// With several volumes, the physical drive's name, with the volumes listed beneath it
		const name =
			mounted.length === 1 ? mounted[0].label || drive.name || t('external-drive') : drive.name || t('external-drive')
		const detail =
			mounted.length > 1
				? mounted.map((partition) => partition.label || partition.mountpoints[0].split('/').at(-1)).join(', ')
				: name !== drive.name
					? drive.name
					: undefined
		return {id: drive.id, name, detail: detail || undefined, size: drive.size}
	})
	return {
		drives,
		failed: devicesQ.isError,
		retrying: devicesQ.isFetching,
		onRetry: () => void devicesQ.refetch(),
		onOpenFiles: () => navigate('/files/External'),
	}
}
