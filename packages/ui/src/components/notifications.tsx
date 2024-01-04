import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ExternalToast} from 'sonner'

import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {trpcReact} from '@/trpc/trpc'
import {isCpuTooHot, isDiskFull, isDiskLow, isMemoryLow} from '@/utils/system'

import {toast} from './ui/toast'

export function useSettingsNotificationCount() {
	const [count, setCount] = useState(0)
	const navigate = useNavigate()

	const diskQ = trpcReact.system.diskUsage.useQuery()
	const memoryQ = trpcReact.system.memoryUsage.useQuery()
	const cpuTempQ = trpcReact.system.cpuTemperature.useQuery()
	// TODO: show whether os has updates available

	const isLoading = cpuTempQ.isLoading || diskQ.isLoading || memoryQ.isLoading

	useEffect(() => {
		if (isLoading) return
		let count = 0
		if (cpuTempQ.data && isCpuTooHot(cpuTempQ.data)) {
			count++
		}
		if (diskQ.data) {
			if (isDiskFull(diskQ.data.available)) {
				count++
			} else if (isDiskLow(diskQ.data.available)) {
				count++
			}
		}
		if (memoryQ.data && isMemoryLow(memoryQ.data)) {
			count++
		}
		setCount(count)
	}, [isLoading, cpuTempQ.data, cpuTempQ.error, diskQ.data, diskQ.error, memoryQ.data, memoryQ.error, navigate])

	return count
}

export function Notifications() {
	const navigate = useNavigate()
	const cpuTempQ = trpcReact.system.cpuTemperature.useQuery()
	const diskQ = trpcReact.system.diskUsage.useQuery()
	const memoryQ = trpcReact.system.memoryUsage.useQuery()

	useEffect(() => {
		const toastOptions: ExternalToast = {
			action: {
				label: 'Open Settings',
				onClick: () => {
					navigate(`/settings#${SETTINGS_SYSTEM_CARDS_ID}`)
				},
			},
		}

		if (cpuTempQ.data && isCpuTooHot(cpuTempQ.data)) {
			toast.error('Too hot!', toastOptions)
		}
		if (diskQ.data) {
			if (isDiskFull(diskQ.data.available)) {
				toast.error('Disk is full!', toastOptions)
			} else if (isDiskLow(diskQ.data.available)) {
				toast.warning('Low disk space!', toastOptions)
			}
		}
		if (memoryQ.data) {
			if (isMemoryLow(memoryQ.data)) {
				toast.warning('Low RAM!', toastOptions)
			}
		}
	}, [cpuTempQ.data, cpuTempQ.error, diskQ.data, diskQ.error, memoryQ.data, memoryQ.error, navigate])

	return null
}
