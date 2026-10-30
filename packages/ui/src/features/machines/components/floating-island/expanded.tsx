import {motion} from 'motion/react'

import {ScrollArea} from '@/components/ui/scroll-area'
import {OsIcon} from '@/features/machines/components/os-icon'
import {getOsVisuals} from '@/features/machines/constants'
import {useOsImages} from '@/features/machines/hooks/use-machines'
import type {Machine, OsImage} from '@/features/machines/types'
import {prettyMbPair} from '@/features/machines/utils'
import {t} from '@/utils/i18n'

// Phase line under the percent: the live download pair while the image
// transfers, then disk preparation (mirrors the machine view's phase split
// at 70% of installProgress)
function installPhaseLine(machine: Machine, osImages: OsImage[]) {
	if (machine.installationState === 'starting') return t('machines.state.starting')
	if (machine.installationState === 'setting-up') return t('machines.completing-setup', {os: machine.osName})
	if (machine.installationState === 'setup-delayed') return t('machines.setup-taking-longer')
	const image = machine.installOsId ? osImages.find((image) => image.id === machine.installOsId) : undefined
	if (image?.state === 'downloading' && image.downloadedMb !== undefined && image.sizeMb) {
		const {downloaded, total} = prettyMbPair(Math.min(image.downloadedMb, image.sizeMb), image.sizeMb)
		return `${t('machines.install-downloading')} · ${t('machines.install-download-progress', {downloaded, total})}`
	}
	return (machine.installProgress ?? 0) < 70 ? t('machines.install-downloading') : t('machines.install-preparing')
}

export function ExpandedContent({machines}: {machines: Machine[]}) {
	const {osImages} = useOsImages()

	// Single install: the machine itself is the hero — its monitor artwork
	// waking up under a breathing brand-colored glow, big percent beside it
	if (machines.length === 1) {
		const machine = machines[0]
		const {color} = getOsVisuals(machine.osId)
		const percent = Math.min(99, Math.round(machine.installProgress ?? 0))

		return (
			<div className='flex size-full items-center justify-between overflow-hidden px-7 py-6'>
				<div className='flex min-w-0 flex-col'>
					<span className='truncate text-sm tracking-tight text-white/90'>
						{t('machines.installing-os', {os: machine.osName})}
					</span>
					<span className='truncate text-xs text-white/50'>{machine.name}</span>
					<div className='mt-2 flex items-baseline gap-1'>
						<span className='text-5xl font-light tracking-tight text-white tabular-nums'>{percent}</span>
						<span className='font-medium text-white/40'>%</span>
					</div>
					<span className='mt-1.5 truncate text-xs text-white/40'>{installPhaseLine(machine, osImages)}</span>
				</div>
				<motion.div
					className='relative mr-1 shrink-0'
					initial={{scale: 0.7, opacity: 0}}
					animate={{scale: 1, opacity: 1}}
					exit={{scale: 0.7, opacity: 0}}
					transition={{type: 'spring', stiffness: 300, damping: 20, delay: 0.05}}
				>
					<motion.div
						aria-hidden
						className='absolute inset-1 rounded-full blur-2xl'
						style={{backgroundColor: color}}
						animate={{opacity: [0.35, 0.6, 0.35]}}
						transition={{duration: 3, repeat: Infinity, ease: 'easeInOut'}}
					/>
					<OsIcon osId={machine.osId} state='installing' className='relative size-24' />
				</motion.div>
			</div>
		)
	}

	// Several installs: a quiet list, one slim progress lane per machine
	return (
		<div className='flex h-full w-full flex-col overflow-hidden py-5'>
			<div className='mb-4 px-5'>
				<span className='text-sm text-white/60'>{t('machines.installing-count', {count: machines.length})}</span>
			</div>
			<ScrollArea className='flex-1 px-5 pb-2'>
				<div className='space-y-3'>
					{machines.map((machine) => {
						const progress = Math.min(99, machine.installProgress ?? 0)
						return (
							<div key={machine.id} className='flex items-center gap-2.5'>
								<OsIcon osId={machine.osId} state='installing' className='size-7 shrink-0' />
								<div className='min-w-0 flex-1'>
									<div className='mb-1 flex items-center justify-between gap-2'>
										<span className='truncate text-xs text-white/90'>{machine.name}</span>
										<span className='shrink-0 text-xs text-white/60 tabular-nums'>{Math.round(progress)}%</span>
									</div>
									<div className='relative h-1 overflow-hidden rounded-full bg-white/20'>
										<div
											className='absolute top-0 left-0 h-full rounded-full bg-brand transition-all duration-300'
											style={{width: `${progress}%`}}
										/>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</ScrollArea>
		</div>
	)
}
