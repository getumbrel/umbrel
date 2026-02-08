// We only ever render this component for Umbrel Pro since it is pro-specific instructions

import {ChevronDown, ChevronUp} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'

import {t} from '@/utils/i18n'

type InstallTipsCollapsibleProps = {
	isOpen: boolean
	onToggle: () => void
}

export function InstallTipsCollapsible({isOpen, onToggle}: InstallTipsCollapsibleProps) {
	return (
		<div>
			<button
				onClick={onToggle}
				className='flex w-full items-center justify-between text-xs font-medium text-brand-lightest transition-opacity duration-300 hover:opacity-80'
			>
				{t('storage-manager.install-tips.toggle')}
				{isOpen ? <ChevronUp className='size-4' /> : <ChevronDown className='size-4' />}
			</button>

			<AnimatePresence>
				{isOpen && (
					<motion.div
						initial={{height: 0, opacity: 0}}
						animate={{height: 'auto', opacity: 1}}
						exit={{height: 0, opacity: 0}}
						transition={{duration: 0.3}}
						className='overflow-hidden'
					>
						<div className='space-y-3'>
							<img
								src='/storage/install-ssd-instruction.webp'
								alt={t('storage-manager.install-tips.image-alt')}
								className='w-full rounded-8'
								draggable={false}
								style={{
									aspectRatio: '1646 / 1186',
									maskImage:
										'linear-gradient(to right, transparent 0%, black 15%), linear-gradient(to bottom, black 85%, transparent 100%)',
									maskComposite: 'intersect',
									WebkitMaskImage:
										'linear-gradient(to right, transparent 0%, black 15%), linear-gradient(to bottom, black 85%, transparent 100%)',
									WebkitMaskComposite: 'source-in',
								}}
							/>
							<p className='text-12 leading-relaxed text-white/60'>{t('storage-manager.install-tips.instructions')}</p>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}
