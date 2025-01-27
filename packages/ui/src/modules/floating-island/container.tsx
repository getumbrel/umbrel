import {AnimatePresence, motion} from 'framer-motion'

import {AudioIsland} from '@/features/files/components/floating-islands/audio-island'
import {UploadingIsland} from '@/features/files/components/floating-islands/uploading-island'
import {useGlobalFiles} from '@/providers/global-files'

const spring = {
	type: 'spring' as const,
	stiffness: 400,
	damping: 30,
}

export function FloatingIslandContainer() {
	// 1. Grab global audio and uploading items state
	const {audio, uploadingItems} = useGlobalFiles()

	// 2. Decide whether to show an AudioIsland
	const showAudio = audio.path && audio.name

	// 3. Decide whether to show an UploadingIsland
	const showUploading = uploadingItems.length > 0

	// 4. Define common animation props
	const commonProps = {
		initial: {opacity: 0, scale: 0, transformOrigin: 'bottom center'},
		animate: {opacity: 1, scale: 1, transformOrigin: 'bottom center'},
		exit: {opacity: 0, scale: 0, transformOrigin: 'bottom center'},
		transition: {layout: spring, opacity: {duration: 0.2}, scale: {duration: 0.2}},
	}

	// 5. Return the container positioned at the bottom, right above the dock
	return (
		// use same z-index as dock, stack the islands vertically on mobile and horizontally on desktop
		<div className='fixed bottom-[76px] left-1/2 z-50 flex w-full -translate-x-1/2 flex-col items-center justify-center gap-1 md:bottom-[90px] md:flex-row md:items-baseline md:gap-2'>
			<AnimatePresence>
				{showUploading && (
					<motion.div key='upload-island' layout {...commonProps}>
						<UploadingIsland />
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
