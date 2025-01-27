import {AnimatePresence, motion, useMotionValue} from 'framer-motion'
import {ChevronLeft} from 'lucide-react'

interface MobileSidebarProps {
	children: React.ReactNode
	isOpen: boolean
	onClose: () => void
}

export function MobileSidebarWrapper({children, isOpen, onClose}: MobileSidebarProps) {
	const x = useMotionValue(0)

	const handleDragEnd = (event: any, {offset, velocity}: any) => {
		// Close if:
		// 1. Dragged more than 100px left OR
		// 2. Dragged more than 50px left with high velocity
		const shouldClose = offset.x < -100 || (offset.x < -50 && velocity.x < -500)

		if (shouldClose) {
			onClose()
		} else {
			// Always animate back to 0 when released
			x.set(0, true) // true enables spring animation
		}
	}

	return (
		<AnimatePresence>
			{isOpen && (
				<>
					{/* Backdrop */}
					<motion.div
						initial={{opacity: 0}}
						animate={{opacity: 1}}
						exit={{opacity: 0}}
						transition={{duration: 0.2}}
						className='fixed inset-0 z-40 h-[100svh] w-[100svw] bg-black/50'
						onClick={onClose}
					/>
					{/* Sidebar */}
					<motion.div
						drag='x'
						dragConstraints={{left: -256, right: 0}}
						dragElastic={0.2}
						dragMomentum={false}
						onDragEnd={handleDragEnd}
						initial={{x: '-100%'}}
						animate={{x: 0}}
						exit={{x: '-100%'}}
						transition={{type: 'spring', damping: 20, stiffness: 200}}
						style={{x}}
						className='fixed inset-y-0 left-0 z-50 -ml-10 w-[256px] border-r border-white/10 bg-black pl-14 md:-ml-3'
					>
						{/* Close button */}
						<div className='absolute right-3 top-8 sm:top-10 md:top-12'>
							<ChevronLeft
								role='button'
								className='h-4 w-4 cursor-pointer text-white/60 transition-colors'
								onClick={onClose}
							/>
						</div>
						<div className='h-12 sm:h-16 md:h-20' /> {/* Spacer for top padding */}
						{/* The actual <Sidebar /> component will be passed in as children */}
						{children}
						{/* Full height drag area with centered visual handle */}
						<div className='absolute right-[-12px] top-0 h-full w-3'>
							{/* Invisible touch target */}
							<div className='absolute inset-0 w-full' />
							{/* Visual handle centered */}
							<div className='absolute left-0 top-1/2 flex h-16 w-full -translate-y-1/2 items-center justify-center'>
								<div className='h-12 w-1 rounded-full bg-white/20' />
							</div>
						</div>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	)
}
