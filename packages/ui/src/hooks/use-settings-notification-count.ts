import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {toast, type ToastOptions} from '@/components/ui/toast'
import {getHeadline} from '@/features/storage/headline'
import {toSingleHost} from '@/features/storage/hooks/use-storage-headline'
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
	const {t, i18n} = useTranslation()
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
			utils.hardware.umbrelPro.isUmbrelPro.fetch(),
			utils.systemNg.device.getIdentity.fetch(),
		])

		const toastIds: (string | number)[] = []

		res.then((allData) => {
			const [
				checkUpdateResult,
				cpuTempResult,
				memoryResult,
				diskResult,
				raidStatusResult,
				devicesResult,
				isProResult,
				identityResult,
			] = allData ?? []

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

			// What Storage Manager would lead with, when that is something wrong: a drive that has
			// failed or may fail, damaged data, storage that has stopped. One toast, in its words.
			// Running out of space has its own toast above.
			if (
				raidStatusResult?.status === 'fulfilled' &&
				devicesResult?.status === 'fulfilled' &&
				isProResult?.status === 'fulfilled'
			) {
				const headline = getHeadline({
					raid: raidStatusResult.value,
					devices: devicesResult.value,
					isPro: isProResult.value,
					host: toSingleHost(identityResult?.status === 'fulfilled' ? identityResult.value : undefined),
					t,
					locale: i18n.language,
				})
				if (headline?.alarming && !headline.space) {
					currCount++
					const raise = headline.tone === 'critical' ? toast.error : toast.warning
					const id = raise(headline.title, {...storageManagerToastOptions, description: headline.body})
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
