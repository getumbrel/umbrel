import {AnimatePresence, motion} from 'motion/react'
import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {BackupsIsland} from '@/features/backups/components/floating-island'
import {useBackupProgress, useBackupProgressLiveUpdates} from '@/features/backups/hooks/use-backups'
import {AudioIsland} from '@/features/files/components/floating-islands/audio-island'
import {CloudIsland} from '@/features/files/components/floating-islands/cloud-island'
import {FormattingIsland} from '@/features/files/components/floating-islands/formatting-island'
import {OperationsIsland} from '@/features/files/components/floating-islands/operations-island'
import {TransfersIsland} from '@/features/files/components/floating-islands/transfers-island'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {useTransfersView} from '@/features/files/transfers/use-transfers'
import {MachinesInstallIsland} from '@/features/machines/components/floating-island'
import {
	useInstallingMachines,
	useMachineInstallToasts,
	useMachinesLiveUpdates,
} from '@/features/machines/hooks/use-machines'
import {PhotosUploadIsland} from '@/features/photos/components/upload-island'
import {usePhotosUploadsFeedback, usePhotosUploadsStatus} from '@/features/photos/hooks/use-upload'
import {RaidIsland} from '@/features/storage/components/floating-island'
import {useRaidProgress} from '@/features/storage/hooks/use-raid-progress'
import {usePendingRaidOperation} from '@/features/storage/providers/pending-operation-context'
import {cloudActivityHasWork, useCloudActivity} from '@/providers/cloud'
import {useGlobalFiles} from '@/providers/global-files'
import {useImmersiveDialogOpen} from '@/providers/immersive-dialog'
import {trpcReact} from '@/trpc/trpc'

const spring = {
	type: 'spring' as const,
	stiffness: 400,
	damping: 30,
}

export function FloatingIslandContainer() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	// When any ImmersiveDialog is open, bump z-index so islands appear above it
	const isImmersiveDialogOpen = useImmersiveDialogOpen()

	// Grab global audio state and the server's operation progress
	const {audio, operations} = useGlobalFiles()
	// Files transfers (uploads, copies, moves) with the server's progress laid over
	const transfersView = useTransfersView(operations)
	// Backups progress
	const backupProgressQ = useBackupProgress(1000)
	// External storage
	const {disks} = useExternalStorage()
	// RAID progress (real events + pending operation set by dialogs)
	const raidProgress = useRaidProgress()
	const {pendingOperation} = usePendingRaidOperation()
	// Cloud transfers (live event-bus snapshots)
	const {activities: cloudActivities} = useCloudActivity()
	// Machines is owner-only. Keep one global subscription for every desktop
	// consumer instead of reconnecting from each surface that reads the cache.
	const isOwner = trpcReact.user.get.useQuery().data?.role === 'owner'
	useMachinesLiveUpdates({enabled: isOwner})
	useBackupProgressLiveUpdates({enabled: isOwner})
	const installingMachines = useInstallingMachines({enabled: isOwner})
	// Announce completed installs and manual installers that are ready for setup
	useMachineInstallToasts({enabled: isOwner})

	// Show audio island if there's an audio file playing
	const showAudio = audio.path && audio.name

	// Show the transfers island while any batch is on screen
	const showTransfers = transfersView.batches.length > 0
	// Photos uploads: the queue lives outside the /photos tree so it (and this
	// island) survive route changes; failure toasts + cache staleness too
	const photosUploadsStatus = usePhotosUploadsStatus()
	usePhotosUploadsFeedback()
	const showPhotosUploads = photosUploadsStatus !== 'idle'

	// Show operations island for progress the transfers island doesn't own:
	// app storage moves, Rewind restores, copies from another tab or a reload
	const managedOperations = transfersView.managedOperations
	const showOperations = managedOperations.length > 0
	// Show backups island if any backups are running
	const showBackups = (backupProgressQ.data?.length || 0) > 0
	// Show formatting island if any devices are being formatted
	const showFormatting = (disks?.filter((disk) => disk.isFormatting).length || 0) > 0
	// Show RAID island if any RAID operation is in progress (real or pending).
	// Scrubs run silently - their results surface via the toasts below, never an island.
	const showRaid = (raidProgress !== null && raidProgress.type !== 'scrub') || pendingOperation !== null
	// Show cloud island only when a download has actual files to move,
	// not during rclone's scan/check phase (no-op syncs never show it)
	const showCloud = cloudActivities.some(cloudActivityHasWork)
	// Show machines island only while a machine is installing
	const showMachinesInstall = installingMachines.length > 0
	const raidOperationType = raidProgress?.type
	const raidOperationState = raidProgress?.state
	const raidScrubErrors = raidProgress?.errors

	useEffect(() => {
		if (raidOperationType !== 'scrub' || raidOperationState !== 'finished') return

		if ((raidScrubErrors ?? 0) > 0) {
			toast.error(t('storage-manager.scrub.error-title'), {
				id: 'raid-scrub-result',
				area: 'settings',
				description: t('storage-manager.scrub.error-description', {count: raidScrubErrors}),
				duration: Infinity,
				fullClick: true,
				action: {
					label: t('notifications.view'),
					onClick: () => navigate('/settings/storage'),
				},
			})
			return
		}

		toast.success(t('storage-manager.scrub.completed-toast'), {
			id: 'raid-scrub-result',
			area: 'settings',
		})
	}, [navigate, raidOperationState, raidOperationType, raidScrubErrors, t])

	// Common animation props
	const commonProps = {
		className: 'pointer-events-auto',
		initial: {opacity: 0, scale: 0, transformOrigin: 'bottom center'},
		animate: {opacity: 1, scale: 1, transformOrigin: 'bottom center'},
		exit: {opacity: 0, scale: 0, transformOrigin: 'bottom center'},
		transition: {layout: spring, opacity: {duration: 0.2}, scale: {duration: 0.2}},
	}

	// Positioned above dock. The full-width layout container must not intercept
	// dialog controls beneath it; only the visible island wrappers are interactive.
	// Normally z-50 (same as dock, but behind immersive dialogs). When an
	// ImmersiveDialog is open, z-60 keeps the islands visible and clickable above it.
	return (
		<div
			className={`pointer-events-none fixed bottom-[76px] left-1/2 flex w-full -translate-x-1/2 transform-gpu flex-col items-center justify-center gap-1 will-change-transform md:bottom-[90px] md:flex-row md:items-baseline md:gap-2 ${isImmersiveDialogOpen ? 'z-[60]' : 'z-50'}`}
		>
			<AnimatePresence>
				{showTransfers && (
					<motion.div key='transfers-island' layout {...commonProps}>
						<TransfersIsland view={transfersView} />
					</motion.div>
				)}
				{showPhotosUploads && (
					<motion.div key='photos-upload-island' layout {...commonProps}>
						<PhotosUploadIsland />
					</motion.div>
				)}
				{showOperations && (
					<motion.div key='operations-island' layout {...commonProps}>
						<OperationsIsland operations={managedOperations} />
					</motion.div>
				)}
				{showFormatting && (
					<motion.div key='formatting-island' layout {...commonProps}>
						<FormattingIsland />
					</motion.div>
				)}
				{showRaid && (
					<motion.div key='raid-island' layout {...commonProps}>
						<RaidIsland />
					</motion.div>
				)}
				{showBackups && (
					<motion.div key='backups-island' layout {...commonProps}>
						<BackupsIsland />
					</motion.div>
				)}
				{showCloud && (
					<motion.div key='cloud-island' layout {...commonProps}>
						<CloudIsland />
					</motion.div>
				)}
				{showMachinesInstall && (
					<motion.div key='machines-install-island' layout {...commonProps}>
						<MachinesInstallIsland machines={installingMachines} />
					</motion.div>
				)}
				{showAudio && (
					<motion.div key='audio-island' layout {...commonProps}>
						<AudioIsland />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}
