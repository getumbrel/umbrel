// Storage setup for Umbrel Pro, and for other hardware that has only SSDs. The screens are in
// features/storage/setup: this page gives them the drives umbreld found, and create-storage
// carries the choice through user.register, the restart that follows, and the launch.

import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'

import {toHardware} from '@/features/storage/from-umbreld'
import {ScanStage} from '@/features/storage/setup/stages'
import {StorageStep} from '@/features/storage/setup/storage-step'
import {recommendedSsdSizeLabel} from '@/features/storage/utils'
import {temperatureUnitFromLocale} from '@/hooks/use-temperature-unit'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {trpcReact} from '@/trpc/trpc'

import {getEligibleStorageDevices} from '../storage-selection'
import {CreatingStorage, summaryOf, useCreateStorage} from './create-storage'
import type {RaidOnboardingVariant} from './index'
import {RaidError} from './raid-error'
import {RecoverExistingInstall} from './recover-existing-install'
import {useDetectStorageDevices} from './use-raid-setup'

export default function RaidSetup({variant = 'pro'}: {variant?: RaidOnboardingVariant}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()
	const isGeneric = variant === 'generic'
	const basePath = isGeneric ? '/onboarding/ssd-raid' : '/onboarding/raid'

	// Get credentials from React Router's location.state (passed from create-account page)
	// location.state survives page refresh (browser History API), lost only on direct URL navigation or new tab.
	// If lost, we redirect to create-account.
	//
	// IMPORTANT: If user refreshes page while device is rebooting, they'll see network errors until the device comes
	// back online, then be redirected to login (since user now exists). They won't see the success page, but the setup still completes successfully.
	const credentials = location.state?.credentials as AccountCredentials | undefined

	// Always fetch fresh devices from server in case user shut down to change an SSD and refreshes current url
	const {
		devices: detected,
		isDetecting,
		isFetching,
		error: inventoryError,
		refetch: refetchDevices,
	} = useDetectStorageDevices()
	// Umbrel Pro owns every drive it reports. Other hardware also reports the drive umbrelOS
	// runs from, which is shown and never offered, and only drives with a stable name can be used.
	const shown = isGeneric ? detected.filter((device) => device.type === 'ssd') : detected
	const devices = isGeneric ? getEligibleStorageDevices(shown) : shown
	const recoverableInstallQ = trpcReact.hardware.raid.hasRecoverableInstall.useQuery(undefined, {
		enabled: !!credentials,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: Infinity,
	})
	const memorySizeQ = trpcReact.system.memorySize.useQuery(undefined, {enabled: !!credentials, retry: false})
	const [setUpAsNew, setSetUpAsNew] = useState(false)
	const {shutdown} = useGlobalSystemState()

	const creation = useCreateStorage(credentials)
	const setupPhase = creation.phase
	const showRecovery = !setupPhase && recoverableInstallQ.data === true && !setUpAsNew

	// Redirect to create-account if credentials are missing (e.g., direct URL navigation or new tab)
	useEffect(() => {
		if (!credentials) {
			navigate('/onboarding/create-account', {replace: true})
		}
	}, [credentials, navigate])

	// Fresh setup needs drives; recovery owns its own completion and redirect.
	useEffect(() => {
		if (!credentials || setupPhase || showRecovery || inventoryError || isDetecting) return
		if (devices.length === 0) {
			navigate(basePath, {state: {credentials}, replace: true})
		}
	}, [basePath, isDetecting, devices.length, credentials, navigate, setupPhase, showRecovery, inventoryError])

	if (!credentials) return null

	// Once the storage is confirmed, nothing the drives report can take the screen away
	if (setupPhase) return <CreatingStorage creation={creation} isPro={!isGeneric} ssd name={credentials.name} />

	// Keep recovery mounted through inventory failures or empty reads during reboot.
	if (showRecovery) {
		return <RecoverExistingInstall devices={devices} variant={variant} ssd onSetUpAsNew={() => setSetUpAsNew(true)} />
	}

	// Don't render while redirecting
	if (!inventoryError && (isDetecting || devices.length === 0)) return null

	// Still finding out whether an earlier setup is on the drives
	if (recoverableInstallQ.isLoading) return <ScanStage isPro={!isGeneric} />

	if (recoverableInstallQ.error || inventoryError) {
		return (
			<RaidError
				title={t('onboarding.raid.error.detection-failed')}
				onRetry={() => {
					void refetchDevices()
					void recoverableInstallQ.refetch()
				}}
				retrying={isFetching || recoverableInstallQ.isFetching}
				detail={inventoryError ?? recoverableInstallQ.error?.message}
				instructions={t('storage-status.check-failed')}
			/>
		)
	}

	return (
		<StorageStep
			hardware={toHardware(shown, !isGeneric)}
			// Setting up as new erases the earlier setup that was found, and the confirmation says so
			earlierSetup={recoverableInstallQ.data === true}
			recommendedSsdSize={memorySizeQ.data ? recommendedSsdSizeLabel(memorySizeQ.data) : undefined}
			temperatureUnit={temperatureUnitFromLocale(navigator.language)}
			onContinue={(config, setup) => creation.start(config, summaryOf(setup))}
			onShutdown={() => shutdown()}
			// Back to the offer to restore, for someone who chose to set up as new
			onBack={setUpAsNew ? () => setSetUpAsNew(false) : undefined}
		/>
	)
}
