import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ExternalToast} from 'sonner'

import {toast} from '@/components/ui/toast'
import {getDeviceHealth} from '@/features/storage/hooks/use-storage'
import {trpcClient} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {isCpuTooHot, isTrpcDiskFull, isTrpcMemoryLow} from '@/utils/system'

function useMounted() {
	const [mounted, setMounted] = useState(false)
	// First render sets mounted to true
	useEffect(() => setMounted(true), [])
	return mounted
}

export function useSettingsNotificationCount() {
	const navigate = useNavigate()

	const mounted = useMounted()
	const [count, setCount] = useState(0)

	useEffect(() => {
		// Checking against `mounted` because of this issue:
		// https://github.com/emilkowalski/sonner/issues/322
		if (!mounted) return

		const res = Promise.allSettled([
			trpcClient.system.checkUpdate.query(),
			trpcClient.system.cpuTemperature.query(),
			trpcClient.system.systemMemoryUsage.query(),
			trpcClient.system.systemDiskUsage.query(),
			trpcClient.hardware.umbrelPro.isUmbrelPro.query(),
			trpcClient.hardware.raid.getStatus.query(),
			trpcClient.hardware.internalStorage.getDevices.query(),
		])

		const toastIds: (string | number)[] = []

		res.then((allData) => {
			const [
				checkUpdateResult,
				cpuTempResult,
				memoryResult,
				diskResult,
				isUmbrelProResult,
				raidStatusResult,
				devicesResult,
			] = allData ?? []

			const isUmbrelPro = isUmbrelProResult?.status === 'fulfilled' && isUmbrelProResult.value

			let currCount = 0

			const liveUsageToastOptions: ExternalToast = {
				action: {
					label: t('notifications.view'),
					onClick: () => {
						navigate(`?dialog=live-usage`)
					},
				},
				// Don't auto-close
				duration: Infinity,
			}

			const cpuTempToastOptions: ExternalToast = {
				action: {
					label: t('notifications.view'),
					onClick: () => {
						navigate(`/settings`)
					},
				},
				// Don't auto-close
				duration: Infinity,
			}

			const softwareUpdateToastOptions: ExternalToast = {
				action: {
					label: t('notifications.view'),
					onClick: () => {
						navigate(`/settings/software-update/confirm`)
					},
				},
				// Don't auto-close
				duration: Infinity,
			}

			const storageManagerToastOptions: ExternalToast = {
				action: {
					label: t('notifications.view'),
					onClick: () => {
						navigate(`/settings/storage`)
					},
				},
				// Don't auto-close
				duration: Infinity,
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

			// Storage notifications only show on Umbrel Pro (Storage Manager is Pro-only)
			// TODO: Consider adding real-time notifications via eventBus subscription for RAID status changes
			if (isUmbrelPro) {
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

				// Check SSD health for issues (temperature, wear, SMART status)
				if (devicesResult?.status === 'fulfilled') {
					const devices = devicesResult.value
					const hasHealthIssue = devices.some((device) => getDeviceHealth(device).hasWarning)

					if (hasHealthIssue) {
						currCount++
						const id = toast.warning(t('notifications.ssd.health.title'), {
							...storageManagerToastOptions,
							description: t('notifications.ssd.health.description'),
						})
						toastIds.push(id)
					}
				}
			}

			setCount(currCount)
		})

		return () => {
			toastIds.map(toast.dismiss)
		}
	}, [mounted, navigate])

	return count
}
