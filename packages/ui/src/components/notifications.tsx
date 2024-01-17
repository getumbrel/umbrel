import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ExternalToast} from 'sonner'

import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {useCpuTemp} from '@/hooks/use-cpu-temp'
import {useDisk} from '@/hooks/use-disk'
import {useMemory} from '@/hooks/use-memory'

import {toast} from './ui/toast'

export function useAppsStoreNotificationCount() {}

export function useSettingsNotificationCount() {
	const [count, setCount] = useState(0)
	const navigate = useNavigate()

	const cpuTemp = useCpuTemp()
	const memory = useMemory()
	const disk = useDisk()
	// TODO: show whether os has updates available

	useEffect(() => {
		let count = 0

		if (cpuTemp.isHot) {
			count++
		}

		if (disk.isDiskFull) {
			count++
		} else if (disk.isDiskLow) {
			count++
		}

		if (memory.isMemoryLow) {
			count++
		}
		setCount(count)
	}, [cpuTemp.isHot, disk.isDiskFull, disk.isDiskLow, memory.isMemoryLow, navigate])

	return count
}

export function Notifications() {
	const navigate = useNavigate()

	const cpuTemp = useCpuTemp()
	const disk = useDisk()
	const memory = useMemory()

	useEffect(() => {
		const toastOptions: ExternalToast = {
			action: {
				label: 'Open Settings',
				onClick: () => {
					navigate(`/settings#${SETTINGS_SYSTEM_CARDS_ID}`)
				},
			},
		}

		if (cpuTemp.isHot) {
			toast.error('Too hot!', toastOptions)
		}

		if (disk.isDiskFull) {
			toast.error('Disk is full!', toastOptions)
		} else if (disk.isDiskLow) {
			toast.warning('Low disk space!', toastOptions)
		}

		if (memory.isMemoryLow) {
			toast.warning('Low RAM!', toastOptions)
		}
	}, [cpuTemp.isHot, disk.isDiskFull, disk.isDiskLow, memory.isMemoryLow, navigate])

	return null
}
