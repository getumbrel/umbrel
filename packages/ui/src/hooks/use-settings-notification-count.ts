import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ExternalToast} from 'sonner'

import {toast} from '@/components/ui/toast'
import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {trpcClient} from '@/trpc/trpc'
import {isCpuTooHot, isTrpcDiskFull, isTrpcDiskLow, isTrpcMemoryLow} from '@/utils/system'

export function useSettingsNotificationCount() {
	const navigate = useNavigate()

	const [mounted, setMounted] = useState(false)

	// First render sets mounted to true
	useEffect(() => {
		if (!mounted) setMounted(true)
	}, [mounted])

	const [count, setCount] = useState(0)

	// Make all the calls at once so we can count properly
	// const queries = trpcReact.useQueries((t) => [
	// 	t.system.version(),
	// 	t.system.latestAvailableVersion(),
	// 	t.system.cpuTemperature(),
	// 	t.system.memoryUsage(),
	// 	t.system.diskUsage(),
	// ])

	useEffect(() => {
		// Checking against `mounted` because of this issue:
		// https://github.com/emilkowalski/sonner/issues/322
		if (!mounted) return

		// alert('useEffect')
		const res = Promise.all([
			trpcClient.system.version.query(),
			trpcClient.system.latestAvailableVersion.query(),
			trpcClient.system.cpuTemperature.query(),
			trpcClient.system.memoryUsage.query(),
			trpcClient.system.diskUsage.query(),
		])

		const toastIds: (string | number)[] = []

		res.then((allData) => {
			console.log('allData', allData)
			const [version, latestAvailableVersion, cpuTemp, memory, disk] = allData ?? []

			let currCount = 0

			const toastOptions: ExternalToast = {
				action: {
					label: 'Open Settings',
					onClick: () => {
						navigate(`/settings#${SETTINGS_SYSTEM_CARDS_ID}`)
					},
				},
				// Don't auto-close
				duration: Infinity,
			}

			if (version !== latestAvailableVersion) {
				currCount++
				const id = toast.info('New version available!', toastOptions)
				toastIds.push(id)
			}

			if (isCpuTooHot(cpuTemp)) {
				currCount++
				const id = toast.error('Too hot!', toastOptions)
				toastIds.push(id)
			}

			if (isTrpcDiskFull(disk)) {
				currCount++
				const id = toast.error('Disk is full!', toastOptions)
				toastIds.push(id)
			} else if (isTrpcDiskLow(disk)) {
				currCount++
			}

			if (isTrpcMemoryLow(memory)) {
				currCount++
				const id = toast.warning('Low disk space!', toastOptions)
				toastIds.push(id)
			}

			setCount(currCount)
		})

		return () => {
			toastIds.map(toast.dismiss)
		}
	}, [mounted, navigate])

	return count
}
