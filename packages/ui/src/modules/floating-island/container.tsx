import {useEffect} from 'react'

import {BackupsIsland} from '@/features/backups/components/floating-island'
import {useBackupProgress, useBackupProgressLiveUpdates} from '@/features/backups/hooks/use-backups'
import {AudioIsland} from '@/features/files/components/floating-islands/audio-island'
import {ClipboardIsland, useShowClipboardIsland} from '@/features/files/components/floating-islands/clipboard-island'
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
import {useStorageToasts} from '@/features/storage/hooks/use-storage-toasts'
import {usePendingRaidOperation} from '@/features/storage/providers/pending-operation-context'
import {cloudActivityHasWork, useCloudActivity} from '@/providers/cloud'
import {useGlobalFiles} from '@/providers/global-files'
import {useImmersiveDialogOpen} from '@/providers/immersive-dialog'
import {trpcReact} from '@/trpc/trpc'

import {useLaneStore} from './lane'
import {IslandRow, LaneItem} from './row'

// Decides which islands are up. Where they stand and how they move is the
// row's business (row.tsx), and what each one shows its own.
export function FloatingIslandContainer() {
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
	// Show the clipboard island while Files is open with something copied or cut
	const showClipboard = useShowClipboardIsland()
	// What a storage check found, and the moment a long storage task ends
	useStorageToasts(raidProgress)

	// In the order they stand in the row
	const islands = [
		showClipboard && <ClipboardIsland key='clipboard-island' />,
		showTransfers && <TransfersIsland key='transfers-island' view={transfersView} />,
		showPhotosUploads && <PhotosUploadIsland key='photos-upload-island' />,
		showOperations && <OperationsIsland key='operations-island' operations={managedOperations} />,
		showFormatting && <FormattingIsland key='formatting-island' />,
		showRaid && <RaidIsland key='raid-island' />,
		showBackups && <BackupsIsland key='backups-island' />,
		showCloud && <CloudIsland key='cloud-island' />,
		showMachinesInstall && <MachinesInstallIsland key='machines-install-island' machines={installingMachines} />,
		showAudio && <AudioIsland key='audio-island' />,
	].filter((island): island is React.ReactElement => !!island)

	// Search and the Machines console make way for however many are up
	const islandCount = islands.length
	const setIslandCount = useLaneStore((state) => state.setIslandCount)
	useEffect(() => setIslandCount(islandCount), [islandCount, setIslandCount])

	// The row must not intercept dialog controls beneath it; only the islands
	// are interactive. Normally z-50 (same as dock, but behind immersive
	// dialogs). When an ImmersiveDialog is open, z-60 keeps the islands visible
	// and clickable above it.
	return (
		<IslandRow className={isImmersiveDialogOpen ? 'z-[60]' : 'z-50'}>
			{islands.map((island) => (
				<LaneItem key={island.key}>{island}</LaneItem>
			))}
		</IslandRow>
	)
}
