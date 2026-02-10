import {AnimatePresence, motion} from 'framer-motion'

import {BackupsIsland} from '@/features/backups/components/floating-island'
import {useBackupProgress} from '@/features/backups/hooks/use-backups'
import {AudioIsland} from '@/features/files/components/floating-islands/audio-island'
import {FormattingIsland} from '@/features/files/components/floating-islands/formatting-island'
import {OperationsIsland} from '@/features/files/components/floating-islands/operations-island'
import {UploadingIsland} from '@/features/files/components/floating-islands/uploading-island'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {RaidIsland} from '@/features/storage/components/floating-island'
import {usePendingRaidOperation} from '@/features/storage/contexts/pending-operation-context'
import {useRaidProgress} from '@/features/storage/hooks/use-raid-progress'
import {useGlobalFiles} from '@/providers/global-files'
import {useImmersiveDialogOpen} from '@/providers/immersive-dialog'

const spring = {
	type: 'spring' as const,
	stiffness: 400,
	damping: 30,
}

export function FloatingIslandContainer() {
	// When any ImmersiveDialog is open, bump z-index so islands appear above it
	const isImmersiveDialogOpen = useImmersiveDialogOpen()

	// Grab global audio and uploading items state
	const {audio, uploadingItems, operations} = useGlobalFiles()
	// Backups progress
	const backupProgressQ = useBackupProgress(1000)
	// External storage
	const {disks} = useExternalStorage()
	// RAID progress (real events + pending operation set by dialogs)
	const raidProgress = useRaidProgress()
	const {pendingOperation} = usePendingRaidOperation()

	// Show audio island if there's an audio file playing
	const showAudio = audio.path && audio.name

	// Show uploading island if there are any uploads in progress
	const showUploading = uploadingItems.length > 0

	// Show operations island if there are any operations in progress
	const showOperations = operations.length > 0
	// Show backups island if any backups are running
	const showBackups = (backupProgressQ.data?.length || 0) > 0
	// Show formatting island if any devices are being formatted
	const showFormatting = (disks?.filter((disk) => disk.isFormatting).length || 0) > 0
	// Show RAID island if any RAID operation is in progress (real or pending)
	const showRaid = raidProgress !== null || pendingOperation !== null

	// Common animation props
	const commonProps = {
		initial: {opacity: 0, scale: 0, transformOrigin: 'bottom center'},
		animate: {opacity: 1, scale: 1, transformOrigin: 'bottom center'},
		exit: {opacity: 0, scale: 0, transformOrigin: 'bottom center'},
		transition: {layout: spring, opacity: {duration: 0.2}, scale: {duration: 0.2}},
	}

	// Positioned above dock. Normally z-50 (same as dock, but behind immersive dialogs).
	// When an ImmersiveDialog is open: z-60 + pointer-events-auto so island appears above dialog and is clickable.
	return (
		<div
			className={`fixed bottom-[76px] left-1/2 flex w-full -translate-x-1/2 flex-col items-center justify-center gap-1 md:bottom-[90px] md:flex-row md:items-baseline md:gap-2 ${isImmersiveDialogOpen ? 'pointer-events-auto z-[60]' : 'z-50'}`}
		>
			<AnimatePresence>
				{showUploading && (
					<motion.div key='upload-island' layout {...commonProps}>
						<UploadingIsland />
					</motion.div>
				)}
				{showOperations && (
					<motion.div key='operations-island' layout {...commonProps}>
						<OperationsIsland />
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
				{showAudio && (
					<motion.div key='audio-island' layout {...commonProps}>
						<AudioIsland />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}
