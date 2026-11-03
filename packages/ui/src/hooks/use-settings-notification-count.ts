import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {toast, type ToastOptions} from '@/components/ui/toast'
import {getDeviceHealth} from '@/features/storage/hooks/use-storage'
import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'
import {isCpuTooHot, isTrpcDiskFull, isTrpcMemoryLow} from '@/utils/system'

function useMounted() {
	const [mounted, setMounted] = useState(false)
	// First render sets mounted to true
	useEffect(() => setMounted(true), [])
	return mounted
}

export function useSettingsNotificationCount() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const utils = trpcReact.useUtils()

	const mounted = useMounted()
	const [count, setCount] = useState(0)

	// System notifications are owner territory, member accounts skip the checks
	const userQ = trpcReact.user.get.useQuery()
	const isOwner = userQ.data?.role === 'owner'

	useEffect(() => {
		// Checking against `mounted` because of this issue:
		// https://github.com/emilkowalski/sonner/issues/322
		if (!mounted || !isOwner) return

		const res = Promise.allSettled([
			// Deferred so it doesn't compete with the page-load requests
			sleep(500).then(() => utils.update.check.fetch()),
			utils.system.cpuTemperature.fetch(),
			utils.system.systemMemoryUsage.fetch(),
			utils.system.systemDiskUsage.fetch(),
			utils.hardware.raid.getStatus.fetch(),
			utils.hardware.internalStorage.getDevices.fetch(),
		])

		const toastIds: (string | number)[] = []

		res.then((allData) => {
			const [checkUpdateResult, cpuTempResult, memoryResult, diskResult, raidStatusResult, devicesResult] =
				allData ?? []

			let currCount = 0

			const liveUsageToastOptions: ToastOptions = {
				area: 'live-usage',
				action: {
					label: t('notifications.view'),
					onClick: () => {
						navigate(`?dialog=live-usage`)
					},
				},
				// Don't auto-close
				duration: Infinity,
				// Single "View" action, so the whole toast is tappable
				fullClick: true,
			}

			const cpuTempToastOptions: ToastOptions = {
				area: 'settings',
				action: {
					label: t('notifications.view'),
					onClick: () => {
						navigate(`/settings`)
					},
				},
				// Don't auto-close
				duration: Infinity,
				// Single "View" action, so the whole toast is tappable
				fullClick: true,
			}

			const softwareUpdateToastOptions: ToastOptions = {
				area: 'umbrelos',
				action: {
					label: t('notifications.view'),
					onClick: () => {
						navigate(`/settings/software-update/confirm`)
					},
				},
				// Don't auto-close
				duration: Infinity,
				// Single "View" action, so the whole toast is tappable
				fullClick: true,
			}

			const storageManagerToastOptions: ToastOptions = {
				area: 'settings',
				action: {
					label: t('notifications.view'),
					onClick: () => {
						navigate(`/settings/storage`)
					},
				},
				// Don't auto-close
				duration: Infinity,
				// Single "View" action, so the whole toast is tappable
				fullClick: true,
			}

			if (checkUpdateResult.status === 'fulfilled') {
				const {name, available} = checkUpdateResult.value

				if (available) {
					currCount++
					const id = toast.info(t('notifications.new-version-available', {update: name}), softwareUpdateToastOptions)
					toastIds.push(id)
				}
			}

			if (cpuTempResult.status === 'fulfilled') {
				const warning = cpuTempResult.value.warning

				if (isCpuTooHot(warning)) {
					currCount++
					const id = toast.warning(t('notifications.cpu.too-hot'), cpuTempToastOptions)
					toastIds.push(id)
				}
			}

			if (diskResult.status === 'fulfilled') {
				const disk = diskResult.value

				if (isTrpcDiskFull(disk)) {
					currCount++
					const id = toast.warning(t('notifications.storage.full'), liveUsageToastOptions)
					toastIds.push(id)
				}
			}

			if (memoryResult.status === 'fulfilled') {
				const memory = memoryResult.value

				if (isTrpcMemoryLow(memory)) {
					currCount++
					const id = toast.warning(t('notifications.memory.low'), liveUsageToastOptions)
					toastIds.push(id)
				}
			}

			// TODO: Consider adding real-time notifications via eventBus subscription for RAID status changes
			// Check RAID status for issues
			if (raidStatusResult?.status === 'fulfilled') {
				const raidStatus = raidStatusResult.value

				if (raidStatus.exists && raidStatus.status && raidStatus.status !== 'ONLINE') {
					currCount++
					const id = toast.warning(t('notifications.raid.issue.title'), {
						...storageManagerToastOptions,
						description: t('notifications.raid.issue.description'),
					})
					toastIds.push(id)
				}
			}

			// Check drive health for issues (temperature, wear, SMART status). SSD wording
			// only when every affected device is an SSD - HDDs get generic drive wording.
			// Translation keys stay literal inside t() so CI's unused-key scan finds them.
			if (devicesResult?.status === 'fulfilled') {
				const unhealthyDevices = devicesResult.value.filter((device) => getDeviceHealth(device).hasWarning)

				if (unhealthyDevices.length > 0) {
					const allSsd = unhealthyDevices.every((device) => device.type === 'ssd')
					currCount++
					const id = toast.warning(
						allSsd ? t('notifications.ssd.health.title') : t('notifications.drive.health.title'),
						{
							...storageManagerToastOptions,
							description: allSsd
								? t('notifications.ssd.health.description')
								: t('notifications.drive.health.description'),
						},
					)
					toastIds.push(id)
				}
			}

			setCount(currCount)
		})

		return () => {
			toastIds.map(toast.dismiss)
		}
	}, [mounted, isOwner, navigate])

	return count
}
