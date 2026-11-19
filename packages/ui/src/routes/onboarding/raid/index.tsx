import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'

import {NoDrivesStage, ScanStage} from '@/features/storage/setup/stages'
import {ShutDownDialog} from '@/features/storage/setup/storage-step'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {trpcReact} from '@/trpc/trpc'

import {RaidError} from './raid-error'
import {useDetectStorageDevices} from './use-raid-setup'

// Minimum time to show the scanning animation (in ms)
const MIN_SCAN_DISPLAY_TIME = 3000

// Entry point for RAID onboarding flow. Detects SSDs and routes to /raid/setup if found.
// Shows inline error states for detection errors or no SSDs found.
export type RaidOnboardingVariant = 'pro' | 'generic'

export default function Raid({variant = 'pro'}: {variant?: RaidOnboardingVariant}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()
	const isGeneric = variant === 'generic'
	const basePath = isGeneric ? '/onboarding/ssd-raid' : '/onboarding/raid'
	const {devices, isDetecting, isFetching, error, refetch} = useDetectStorageDevices({genericSsd: isGeneric})
	const {shutdown} = useGlobalSystemState()
	const [shuttingDown, setShuttingDown] = useState(false)

	// Get credentials passed from create-account page via React Router's location.state
	const credentials = location.state?.credentials as AccountCredentials | undefined
	const recoverableInstallQ = trpcReact.hardware.raid.hasRecoverableInstall.useQuery(undefined, {
		enabled: !!credentials,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: Infinity,
	})

	// Track minimum display time and detection complete state
	const [minTimeElapsed, setMinTimeElapsed] = useState(false)
	const [detectionComplete, setDetectionComplete] = useState(false)

	// Redirect to create-account if credentials are missing (e.g., direct URL navigation or new tab)
	useEffect(() => {
		if (!credentials) {
			navigate('/onboarding/create-account', {replace: true})
		}
	}, [credentials, navigate])

	// Start minimum display timer
	useEffect(() => {
		if (!credentials) return

		const timer = setTimeout(() => {
			setMinTimeElapsed(true)
		}, MIN_SCAN_DISPLAY_TIME)

		return () => clearTimeout(timer)
	}, [credentials])

	// Mark detection as complete once min time elapsed and not detecting
	useEffect(() => {
		if (minTimeElapsed && !isDetecting && !recoverableInstallQ.isLoading) {
			setDetectionComplete(true)
		}
	}, [minTimeElapsed, isDetecting, recoverableInstallQ.isLoading])

	// Navigate to setup if SSDs found (after detection complete)
	// Note: We only pass credentials, not devices. Setup page fetches its own fresh device list
	// to avoid stale data issues after hardware changes (e.g., user shuts down to change an SSD, boots up, refreshes current page)
	useEffect(() => {
		if (!credentials || error || recoverableInstallQ.isError) return
		if (detectionComplete && devices.length > 0 && recoverableInstallQ.data !== undefined) {
			navigate(`${basePath}/setup`, {state: {credentials}})
		}
	}, [
		basePath,
		detectionComplete,
		devices.length,
		credentials,
		navigate,
		error,
		recoverableInstallQ.isError,
		recoverableInstallQ.data,
	])

	// Don't render while redirecting due to missing credentials
	if (!credentials) return null

	const lookAgain = () => {
		void refetch()
		void recoverableInstallQ.refetch()
	}

	// Show error state if detection failed
	if (error || recoverableInstallQ.error) {
		return (
			<RaidError
				onRetry={lookAgain}
				retrying={isFetching || recoverableInstallQ.isFetching}
				title={t('onboarding.raid.error.detection-failed')}
				detail={error ?? recoverableInstallQ.error?.message}
				instructions={
					isGeneric
						? t('onboarding.ssd-raid.error.detection-instructions')
						: t('onboarding.raid.error.detection-instructions')
				}
			/>
		)
	}

	// Nothing to set up yet
	if (detectionComplete && devices.length === 0) {
		return (
			<>
				<NoDrivesStage
					isPro={!isGeneric}
					looking={isFetching || recoverableInstallQ.isFetching}
					onLookAgain={lookAgain}
					onShutdown={() => setShuttingDown(true)}
				/>
				<ShutDownDialog
					isPro={!isGeneric}
					// Both of these pages are for machines with nothing but SSDs
					ssd
					open={shuttingDown}
					onOpenChange={setShuttingDown}
					onShutdown={() => shutdown()}
					reason='change'
				/>
			</>
		)
	}

	return <ScanStage isPro={!isGeneric} />
}
