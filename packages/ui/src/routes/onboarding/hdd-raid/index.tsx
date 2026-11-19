// Storage setup for other hardware with hard drives, with or without SSDs beside them. The
// screens are in features/storage/setup: this page finds the drives, offers to restore an
// earlier setup, and hands the choice to /onboarding/hdd-raid/setup, which creates the
// storage and sees the restart through.

import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'

import {toHardware} from '@/features/storage/from-umbreld'
import {NoDrivesStage, ScanStage} from '@/features/storage/setup/stages'
import {ShutDownDialog, StorageStep} from '@/features/storage/setup/storage-step'
import {recommendedSsdSizeLabel} from '@/features/storage/utils'
import {temperatureUnitFromLocale} from '@/hooks/use-temperature-unit'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

import {summaryOf} from '../raid/create-storage'
import {RaidError} from '../raid/raid-error'
import {useDetectStorageDevices} from '../raid/use-raid-setup'
import {HddRecoverExistingInstall} from './recover-existing-install'
import {getCandidates, HddRaidSetupState} from './use-hdd-raid-onboarding'

export default function HddRaidOnboarding() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	// Credentials passed from create-account via location.state (same pattern as the Pro
	// RAID flow: survives refresh, lost on direct URL navigation - then we redirect back)
	const credentials = location.state?.credentials as AccountCredentials | undefined

	const {devices, isDetecting, isFetching, error, refetch} = useDetectStorageDevices()
	// A pre-existing umbrelOS RAID install on the attached drives gets a restore-or-erase
	// choice before we offer a fresh setup (same flow as Pro onboarding)
	const recoverableInstallQ = trpcReact.hardware.raid.hasRecoverableInstall.useQuery(undefined, {
		enabled: !!credentials,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: Infinity,
	})
	const memorySizeQ = trpcReact.system.memorySize.useQuery(undefined, {enabled: !!credentials, retry: false})
	const [setUpAsNew, setSetUpAsNew] = useState(false)
	// True while an explicit "Look again" is in flight (the background poll doesn't set this)
	const [isRescanning, setIsRescanning] = useState(false)
	const [shuttingDown, setShuttingDown] = useState(false)
	const {shutdown} = useGlobalSystemState()

	// Redirect to create-account if credentials are missing
	useEffect(() => {
		if (!credentials) navigate('/onboarding/create-account', {replace: true})
	}, [credentials, navigate])

	const {hdds, ssds} = getCandidates(devices)

	if (!credentials) return null

	// Keep recovery mounted through inventory failures during its expected reboot.
	// Setting up as new erases nothing here: the storage step's own confirmation does.
	if (recoverableInstallQ.data === true && !setUpAsNew) {
		return <HddRecoverExistingInstall devices={[...hdds, ...ssds]} onSetUpAsNew={() => setSetUpAsNew(true)} />
	}

	if (isDetecting || recoverableInstallQ.isLoading) return <ScanStage isPro={false} />

	if (error || recoverableInstallQ.isError) {
		return (
			<RaidError
				title={t('onboarding.raid.error.detection-failed')}
				instructions={t('storage-status.check-failed')}
				detail={error ?? recoverableInstallQ.error?.message}
				onRetry={() => {
					void refetch()
					void recoverableInstallQ.refetch()
				}}
				retrying={isFetching || recoverableInstallQ.isFetching}
			/>
		)
	}

	// Look again with a brief minimum wait, so the click visibly registers even when the
	// answer comes back at once with nothing new
	const lookAgain = async () => {
		setIsRescanning(true)
		try {
			await Promise.all([refetch(), sleep(600)])
		} finally {
			setIsRescanning(false)
		}
	}

	const shutDownDialog = (
		<ShutDownDialog
			isPro={false}
			open={shuttingDown}
			onOpenChange={setShuttingDown}
			onShutdown={() => shutdown()}
			reason='change'
		/>
	)

	if (hdds.length === 0 && ssds.length === 0) {
		return (
			<>
				<NoDrivesStage
					isPro={false}
					looking={isRescanning}
					onLookAgain={() => void lookAgain()}
					onShutdown={() => setShuttingDown(true)}
				/>
				{shutDownDialog}
			</>
		)
	}

	return (
		<StorageStep
			hardware={toHardware(devices, false)}
			// Setting up as new erases the earlier setup that was found, and the confirmation says so
			earlierSetup={recoverableInstallQ.data === true}
			recommendedSsdSize={memorySizeQ.data ? recommendedSsdSizeLabel(memorySizeQ.data) : undefined}
			temperatureUnit={temperatureUnitFromLocale(navigator.language)}
			onContinue={(config, setup) => {
				const state: HddRaidSetupState = {credentials, config, summary: summaryOf(setup)}
				navigate('/onboarding/hdd-raid/setup', {state})
			}}
			onShutdown={() => shutdown()}
			// Back to the offer to restore, for someone who chose to set up as new
			onBack={setUpAsNew ? () => setSetUpAsNew(false) : undefined}
		/>
	)
}
