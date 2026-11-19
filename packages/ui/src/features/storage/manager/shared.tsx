// What Storage Manager's screen and its sheets both need

import {useId} from 'react'
import {useTranslation} from 'react-i18next'
import {TbCheck} from 'react-icons/tb'

import externalStorage from '@/features/files/assets/external-storage-icon.png'
import {cn} from '@/lib/utils'

import {TemperatureUnit} from '../drive-facts'
import {formatSize} from '../model'
import {focusRing, Rows} from '../parts'
import {Offer, StorageAction, StorageState} from '../state'

export type StorageManagerProps = {
	state: StorageState
	// Asks umbreld for a change. Resolves once umbreld has taken it on, rejects with its refusal.
	run: (action: StorageAction) => Promise<void>
	onClose: () => void
	onShutdown: () => void
	onRestart: () => void
	onOpenBackups: () => void
	// USB drives can't be storage, but people look for them here
	usb?: UsbDrivesProps
	temperatureUnit?: TemperatureUnit
	// The SSD size that suits this machine's memory, for acceleration
	recommendedSsdSize?: string
	supportUrl?: string
}

export const offerLabel = (t: ReturnType<typeof useTranslation>['t'], offer: Offer) =>
	offer.id === 'failsafe'
		? t('storage-mgr.action.turn-on-failsafe')
		: offer.id === 'pair'
			? t('storage-mgr.action.add-pair')
			: offer.id === 'accelerate'
				? t('storage-mgr.action.turn-on-acceleration')
				: offer.id === 'replace'
					? t('storage-mgr.action.replace.drive')
					: // What can't be undone is named on the button
						offer.closes
						? t('storage-mgr.action.add-without-failsafe')
						: t('storage-mgr.action.add-to-storage')

// Turning on FailSafe from a single drive happens in three steps, and umbrelOS goes away for
// the middle one. Saying so up front is the difference between a restart and a scare. The
// step under way carries the task's one number.
export function Timeline({current, progress}: {current: number; progress?: number}) {
	const {t} = useTranslation()
	const steps = [t('storage-mgr.step.copy'), t('storage-mgr.step.restart'), t('storage-mgr.step.protect')]
	return (
		<ol className='flex items-start'>
			{steps.map((step, index) => {
				const done = index < current
				const active = index === current
				return (
					<li
						key={step}
						aria-current={active ? 'step' : undefined}
						className='flex flex-1 flex-col items-center gap-1.5'
					>
						<span className='flex w-full items-center'>
							<span
								className={cn(
									'h-0.5 flex-1 rounded-full',
									index === 0 ? 'opacity-0' : done || active ? 'bg-white/80' : 'bg-white/12',
								)}
							/>
							<span
								className={cn(
									'flex size-5 shrink-0 items-center justify-center rounded-full text-11 font-semibold transition-colors',
									done
										? 'bg-white/90 text-black'
										: active
											? 'bg-white/15 text-white ring-2 ring-white/80'
											: 'bg-white/10 text-white/40',
								)}
							>
								{done ? <TbCheck className='size-3' strokeWidth={3.5} /> : index + 1}
							</span>
							<span
								className={cn(
									'h-0.5 flex-1 rounded-full',
									index === steps.length - 1 ? 'opacity-0' : done ? 'bg-white/80' : 'bg-white/12',
								)}
							/>
						</span>
						<span
							className={cn(
								'text-12 font-medium tabular-nums',
								active ? 'text-white/90' : done ? 'text-white/60' : 'text-white/35',
							)}
						>
							{step}
							{active && progress !== undefined && ` - ${Math.floor(progress)}%`}
						</span>
					</li>
				)
			})}
		</ol>
	)
}

// USB drives can't be storage, but people look for them here
export type UsbDrive = {id: string; name: string; detail?: string; size: number}
export type UsbDrivesProps = {
	drives: UsbDrive[]
	// The list couldn't be loaded
	failed?: boolean
	retrying?: boolean
	onRetry?: () => void
	onOpenFiles?: () => void
}

export function UsbDrives({drives, failed, retrying, onRetry, onOpenFiles}: UsbDrivesProps) {
	const {t} = useTranslation()
	const titleId = useId()
	// The first load is quiet, and with no USB drives there is no section
	if (drives.length === 0 && !failed) return null
	return (
		<section aria-labelledby={titleId} className='flex flex-col gap-2.5'>
			<div className='flex flex-col gap-1'>
				<div className='flex items-center justify-between gap-3'>
					<h2 id={titleId} className='text-13 font-semibold text-white/50'>
						{t('storage-manager.usb-drives')}
					</h2>
					{onOpenFiles && (
						<button
							type='button'
							onClick={onOpenFiles}
							className={cn(
								'flex shrink-0 items-center gap-1 rounded-full border border-white/8 bg-white/6 px-3 py-1 text-12 font-medium text-white/80 transition-colors hover:bg-white/10',
								focusRing,
							)}
						>
							<img
								src='/assets/dock/dock-files.webp'
								alt=''
								draggable={false}
								className='size-4 shrink-0 rounded-[4px]'
							/>
							<span>{t('storage-manager.usb-drives.open-files', {app: t('files')})}</span>
						</button>
					)}
				</div>
				<p className='text-13 leading-relaxed text-white/50'>{t('storage-manager.usb-drives.description')}</p>
			</div>
			{failed && (
				<div role='status' className='flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-white/50'>
					<p>{t('storage-manager.usb-drives.unavailable')}</p>
					{onRetry && (
						<button
							type='button'
							disabled={retrying}
							onClick={onRetry}
							className='text-white/80 underline underline-offset-2 hover:text-white disabled:opacity-50'
						>
							{t('try-again')}
						</button>
					)}
				</div>
			)}
			{drives.length > 0 && (
				<Rows>
					{drives.map((drive) => (
						<div key={drive.id} className='flex min-h-[56px] items-center gap-3 px-3.5 py-2'>
							<img src={externalStorage} alt='' draggable={false} className='size-10 shrink-0 object-contain' />
							<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
								<span className='truncate text-14 font-medium text-white/85' title={drive.name}>
									{drive.name}
								</span>
								<span className='truncate text-12 leading-snug text-white/45' title={drive.detail}>
									{formatSize(drive.size)}
									{drive.detail && ` - ${drive.detail}`}
								</span>
							</span>
						</div>
					))}
				</Rows>
			)}
		</section>
	)
}
