// An earlier Umbrel setup was found on the drives. It can be restored, or the drives can be
// set up as new. Nothing is erased here: setting up as new goes on to the storage step, and
// that step's own confirmation is the one place the drives are erased.

import {useState} from 'react'

import type {DriveView} from '@/features/storage/art'
import {toDrive} from '@/features/storage/from-umbreld'
import {EarlierSetupStage, FailedStage, WorkingStage} from '@/features/storage/setup/stages'
import {ShutDownDialog} from '@/features/storage/setup/storage-step'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {ReturnToStart} from '@/routes/onboarding/raid/return-to-start'

import type {RaidOnboardingVariant} from './index'
import {StorageDevice} from './use-raid-setup'
import {useRecoverExistingInstall} from './use-recover-existing-install'

type RecoverExistingInstallProps = {
	devices: StorageDevice[]
	variant?: RaidOnboardingVariant
	// The machine has nothing but SSDs, so it is told about SSDs
	ssd?: boolean
	onSetUpAsNew: () => void
}

export function RecoverExistingInstall({devices, variant = 'pro', ssd, onSetUpAsNew}: RecoverExistingInstallProps) {
	const isPro = variant !== 'generic'
	const {shutdown} = useGlobalSystemState()
	const [shuttingDown, setShuttingDown] = useState(false)

	const {
		handleRestore,
		restoreRequested,
		restoreFailed,
		errorMessage,
		outcomeUnknown,
		showWaitNotice,
		checkStatus,
		checking,
	} = useRecoverExistingInstall()

	if (restoreRequested && !restoreFailed) {
		return (
			<WorkingStage
				isPro={isPro}
				ssd={ssd}
				restoring
				// The connection was lost before umbreld could confirm, or it has simply been a while
				waiting={outcomeUnknown ? 'connection-lost' : showWaitNotice ? 'still-working' : undefined}
				checking={checking}
				onCheckAgain={outcomeUnknown || showWaitNotice ? () => void checkStatus() : undefined}
				actions={showWaitNotice ? <ReturnToStart /> : undefined}
			/>
		)
	}

	if (restoreFailed) {
		return (
			<>
				<FailedStage
					ssd={ssd}
					restoring
					canRetry
					detail={errorMessage}
					onRetry={() => void handleRestore()}
					onShutdown={() => setShuttingDown(true)}
					onSetUpAsNew={onSetUpAsNew}
				/>
				<ShutDownDialog
					isPro={isPro}
					ssd={ssd}
					open={shuttingDown}
					onOpenChange={setShuttingDown}
					onShutdown={() => shutdown()}
					reason='check'
				/>
			</>
		)
	}

	// umbreld says an earlier setup is there, not which drives hold it: every drive is shown alike
	const drives: DriveView[] = devices
		.filter((device): device is StorageDevice & {id: string} => !!device.id)
		.map((device) => ({id: device.id, drive: toDrive(device), tone: 'in'}))

	return (
		<EarlierSetupStage
			isPro={isPro}
			drives={drives}
			onRestore={() => void handleRestore()}
			onSetUpAsNew={onSetUpAsNew}
		/>
	)
}
