import {ChevronLeft} from 'lucide-react'
import {AnimatePresence, motion, useMotionValue} from 'motion/react'
import {useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'

import {focusRingClass} from '@/utils/element-classes'

interface MobileSidebarProps {
	children: React.ReactNode
	isOpen: boolean
	onClose: () => void
	// The drawer's accessible name
	label: string
}

export function MobileSidebarWrapper({children, isOpen, onClose, label}: MobileSidebarProps) {
	const {t} = useTranslation()
	const x = useMotionValue(0)
	const panelRef = useRef<HTMLDivElement>(null)
	const onCloseRef = useRef(onClose)
	onCloseRef.current = onClose

	// While open the drawer has the keyboard, as a dialog would: focus moves in,
	// Escape closes it (and nothing beneath), and focus goes back on close
	useEffect(() => {
		if (!isOpen) return
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
		panelRef.current?.focus({preventScroll: true})
		const handleKeyDown = (event: KeyboardEvent) => {
			// Only from inside the drawer: a dialog opened from it (Add network share)
			// sits on top and takes its own Escape
			if (event.key !== 'Escape' || !panelRef.current?.contains(event.target as Node)) return
			event.stopPropagation()
			onCloseRef.current()
		}
		window.addEventListener('keydown', handleKeyDown, {capture: true})
		return () => {
			window.removeEventListener('keydown', handleKeyDown, {capture: true})
			if (opener?.isConnected) opener.focus({preventScroll: true})
		}
	}, [isOpen])

	const handleDragEnd = (event: any, {offset, velocity}: any) => {
		// Close if:
		// 1. Dragged more than 100px left OR
		// 2. Dragged more than 50px left with high velocity
		const shouldClose = offset.x < -100 || (offset.x < -50 && velocity.x < -500)

		if (shouldClose) {
			onClose()
		} else {
			// Always animate back to 0 when released
			x.set(0)
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
						ref={panelRef}
						role='dialog'
						aria-modal='true'
						aria-label={label}
						tabIndex={-1}
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
						className='fixed inset-y-0 left-0 z-50 -ml-10 w-[256px] border-r border-white/10 bg-black pl-14 outline-hidden md:-ml-3'
					>
						{/* Close button */}
						<div className='absolute top-4 right-3'>
							<button
								type='button'
								onClick={onClose}
								aria-label={t('close')}
								className={`-m-2 rounded-full p-2 ${focusRingClass}`}
							>
								<ChevronLeft className='h-4 w-4 text-white/60 transition-colors' />
							</button>
						</div>
						<div className='h-12 sm:h-16 md:h-20 low:h-10' /> {/* Spacer for top padding */}
						{/* The actual <Sidebar /> component will be passed in as children */}
						{children}
						{/* Full height drag area with centered visual handle */}
						<div className='absolute top-0 right-[-12px] h-full w-3'>
							{/* Invisible touch target */}
							<div className='absolute inset-0 w-full' />
							{/* Visual handle centered */}
							<div className='absolute top-1/2 left-0 flex h-16 w-full -translate-y-1/2 items-center justify-center'>
								<div className='h-12 w-1 rounded-full bg-white/20' />
							</div>
						</div>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	)
}
