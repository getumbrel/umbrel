import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ExternalToast} from 'sonner'

import {toast} from '@/components/ui/toast'
import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {useCpuTemp} from '@/hooks/use-cpu-temp'
import {useDisk} from '@/hooks/use-disk'
import {useMemory} from '@/hooks/use-memory'

export function useSettingsNotificationCount() {
	const [count, setCount] = useState(0)
	const navigate = useNavigate()

	const cpuTemp = useCpuTemp()
	const memory = useMemory()
	const disk = useDisk()

	useEffect(() => {
		let count = 0

		const toastOptions: ExternalToast = {
			action: {
				label: 'Open Settings',
				onClick: () => {
					navigate(`/settings#${SETTINGS_SYSTEM_CARDS_ID}`)
				},
			},
		}

		if (cpuTemp.isHot) {
			count++
			toast.error('Too hot!', toastOptions)
		}

		if (disk.isDiskFull) {
			count++
			toast.error('Disk is full!', toastOptions)
		} else if (disk.isDiskLow) {
			count++
		}

		if (memory.isMemoryLow) {
			count++
			toast.warning('Low disk space!', toastOptions)
		}

		setCount(count)
	}, [cpuTemp.isHot, disk.isDiskFull, disk.isDiskLow, memory.isMemoryLow, navigate])

	return count
}
