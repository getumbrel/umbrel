import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ExternalToast} from 'sonner'

import {toast} from '@/components/ui/toast'
import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {trpcClient} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {isCpuTooCold, isCpuTooHot, isTrpcDiskFull, isTrpcDiskLow, isTrpcMemoryLow} from '@/utils/system'
import {CpuType} from '@/utils/temperature'

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

		const cpuType: CpuType = 'pi'

		const toastIds: (string | number)[] = []

		res.then((allData) => {
			console.log('allData', allData)
			const [version, latestAvailableVersion, cpuTemp, memory, disk] = allData ?? []

			let currCount = 0

			const toastOptions: ExternalToast = {
				action: {
					label: t('notifications.open-settings'),
					onClick: () => {
						navigate(`/settings#${SETTINGS_SYSTEM_CARDS_ID}`)
					},
				},
				// Don't auto-close
				duration: Infinity,
			}

			if (version !== latestAvailableVersion.version) {
				currCount++
				const id = toast.info(t('notifications.new-version-available'), toastOptions)
				toastIds.push(id)
			}

			if (isCpuTooHot(cpuType, cpuTemp)) {
				currCount++
				const id = toast.error(t('notifications.cpu.too-hot'), toastOptions)
				toastIds.push(id)
			} else if (isCpuTooCold(cpuType, cpuTemp)) {
				currCount++
				const id = toast.error(t('notifications.cpu.too-cold'), toastOptions)
				toastIds.push(id)
			}

			if (isTrpcDiskFull(disk)) {
				currCount++
				const id = toast.error(t('notifications.storage.full'), toastOptions)
				toastIds.push(id)
			} else if (isTrpcDiskLow(disk)) {
				currCount++
				// TODO: show message when disk is low?
				// const id = toast.error(t('notifications.storage.low'), toastOptions)
				// toastIds.push(id)
			}

			if (isTrpcMemoryLow(memory)) {
				currCount++
				const id = toast.warning(t('notifications.memory.low'), toastOptions)
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
