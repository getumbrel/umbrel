import {Loader2, Power} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {useEffect, useRef, useState} from 'react'
import {TbAlertTriangleFilled} from 'react-icons/tb'

import {Progress} from '@/components/ui/progress'
import {MachineConsole} from '@/features/machines/components/machine-console'
import {OsIcon} from '@/features/machines/components/os-icon'
import {machineStopTextClass} from '@/features/machines/constants'
import {getMachinesErrorMessage, useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useOsImages} from '@/features/machines/hooks/use-machines'
import type {Machine} from '@/features/machines/types'
import {prettyMb, prettyMbPair} from '@/features/machines/utils'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'
import {secondsToEta} from '@/utils/seconds-to-eta'

// Shared "start" affordance on the stopped/error screens
const screenActionButtonClass =
	'flex h-[30px] items-center rounded-full border-hpx border-white/20 bg-white/10 px-4 text-13 font-medium text-white transition-[background-color,transform] duration-200 hover:bg-white/15 active:scale-95'

// The VM "screen": renders whatever the machine would be showing for its
// current state, crossfading between states. Fills its (relatively
// positioned) parent.
export function MachineDisplay({machine}: {machine: Machine}) {
	const consoleVisible = ['starting', 'running', 'restarting', 'stopping'].includes(machine.state)
	return (
		<AnimatePresence initial={false}>
			<motion.div
				// Keyed by machine too: switching between VMs crossfades the
				// screens in place instead of hard-swapping content
				// Keep the console mounted across restart lifecycle states. Remounting
				// briefly opened overlapping sessions during the crossfade, causing this
				// tab to supersede itself and show the multi-tab takeover overlay.
				key={`${machine.id}:${consoleVisible ? 'console' : machine.state}`}
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				exit={{opacity: 0}}
				transition={{duration: 0.4, ease: 'easeOut'}}
				className='absolute inset-0'
			>
				<Screen machine={machine} />
			</motion.div>
		</AnimatePresence>
	)
}

function Screen({machine}: {machine: Machine}) {
	switch (machine.state) {
		case 'installing':
			return <InstallingScreen machine={machine} />
		case 'starting':
		case 'restarting':
		case 'running':
		case 'stopping':
			return <ConsoleScreen machine={machine} />
		case 'error':
			return <ErrorScreen machine={machine} />
		case 'stopped':
			return <StoppedScreen machine={machine} />
	}
}

function ConsoleScreen({machine}: {machine: Machine}) {
	const [showSetupConsole, setShowSetupConsole] = useState(false)
	// QEMU's VNC resize extension can diverge from Linux fbcon's scanout
	// geometry. Keep built-in text consoles at their native framebuffer size;
	// graphical guests can still follow the browser at native resolution.
	// Android is fixed too: Cage keeps the mode it booted with and Waydroid
	// cannot resize Android's display afterwards.
	const isTextConsole = machine.osVariant === 'Server' || machine.osId === 'alpine'
	const followsBrowserSize = !isTextConsole && machine.osId !== 'android'
	const setupDelayed = machine.installationState === 'setup-delayed'

	return (
		<>
			<MachineConsole machineId={machine.id} resizeSession={followsBrowserSize} />
			{machine.state === 'running' && machine.firstBootSetup && !showSetupConsole && (
				<FirstBootSetupOverlay
					osName={machine.osName}
					delayed={setupDelayed}
					onOpenConsole={() => setShowSetupConsole(true)}
				/>
			)}
			{machine.state === 'stopping' && (
				<div className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm'>
					<Loader2 className='size-6 animate-spin text-white/70' />
					<span className='text-13 text-white/70'>{t('machines.shutting-down')}</span>
				</div>
			)}
		</>
	)
}

export function FirstBootSetupOverlay({
	osName,
	delayed,
	onOpenConsole,
}: {
	osName: string
	delayed: boolean
	onOpenConsole: () => void
}) {
	return (
		<div className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center backdrop-blur-sm'>
			<Loader2 className='size-6 animate-spin text-white/70' />
			{delayed ? (
				<>
					<span className='text-13 font-medium text-white/80'>{t('machines.setup-taking-longer')}</span>
					<span className='max-w-sm text-12 leading-relaxed text-white/50'>
						{t('machines.setup-taking-longer-description', {os: osName})}
					</span>
					<button type='button' className={cn(screenActionButtonClass, 'mt-1 cursor-pointer')} onClick={onOpenConsole}>
						{t('machines.open-console')}
					</button>
				</>
			) : (
				<span className='text-13 text-white/70'>{t('machines.completing-setup', {os: osName})}</span>
			)}
		</div>
	)
}

// Backend progress events arrive roughly once per second while a download is
// flowing, so a quiet spell this long means the transfer has stalled
const DOWNLOAD_STALL_MS = 5_000

// Client-side download rate estimate: the backend only reports cumulative
// downloaded MB, so sample deltas (spaced at least a second apart) and smooth
// with an EMA to keep the readout stable across bursty progress events. The
// rate is null until two values arrive, and reverts to null when progress
// stops so a stalled download can't keep showing a frozen speed and ETA.
function useDownloadRate(downloadedMb: number | undefined) {
	const sampleRef = useRef<{time: number; mb: number} | null>(null)
	const smoothedRef = useRef<number | null>(null)
	const [rateMbPerSec, setRateMbPerSec] = useState<number | null>(null)

	useEffect(() => {
		if (downloadedMb === undefined) {
			sampleRef.current = null
			smoothedRef.current = null
			setRateMbPerSec(null)
			return
		}
		const now = Date.now()
		const previous = sampleRef.current
		// First reported value, or a restarted download
		if (!previous || downloadedMb < previous.mb) {
			sampleRef.current = {time: now, mb: downloadedMb}
			smoothedRef.current = null
			setRateMbPerSec(null)
			return
		}
		const elapsedSeconds = (now - previous.time) / 1000
		if (elapsedSeconds < 1) return
		const rate = (downloadedMb - previous.mb) / elapsedSeconds
		sampleRef.current = {time: now, mb: downloadedMb}
		smoothedRef.current = smoothedRef.current === null ? rate : smoothedRef.current * 0.7 + rate * 0.3
		setRateMbPerSec(smoothedRef.current)
	}, [downloadedMb])

	// Stall watchdog: the sampling effect above only runs when a new value
	// arrives, so without this a stalled transfer would freeze the last readout.
	// Dropping the sample too means measurements never span a stall.
	const active = downloadedMb !== undefined
	useEffect(() => {
		if (!active) return
		const interval = setInterval(() => {
			const lastSample = sampleRef.current
			if (lastSample && Date.now() - lastSample.time > DOWNLOAD_STALL_MS) {
				sampleRef.current = null
				smoothedRef.current = null
				setRateMbPerSec(null)
			}
		}, 1_000)
		return () => clearInterval(interval)
	}, [active])

	return rateMbPerSec
}

function InstallingScreen({machine}: {machine: Machine}) {
	const {osImages} = useOsImages()
	// The machine view exposes the exact catalog image id this install sources
	// from (machine.osId is only the family, which cannot disambiguate variants
	// or custom images)
	const image = machine.installOsId ? osImages.find((image) => image.id === machine.installOsId) : undefined
	const downloading = image?.state === 'downloading'
	const rateMbPerSec = useDownloadRate(downloading ? image?.downloadedMb : undefined)

	// Install phases: image download maps to 0–70% of installProgress, disk
	// preparation covers the rest
	let status = t('machines.install-preparing')
	if (downloading) {
		const parts = [t('machines.install-downloading')]
		// sizeMb is the catalog's estimate, which the real transfer can slightly
		// overshoot — clamp the pair and drop the ETA once remaining reaches zero
		if (image.downloadedMb !== undefined && image.sizeMb) {
			const {downloaded, total} = prettyMbPair(Math.min(image.downloadedMb, image.sizeMb), image.sizeMb)
			parts.push(t('machines.install-download-progress', {downloaded, total}))
		}
		if (rateMbPerSec !== null) {
			parts.push(`${prettyMb(rateMbPerSec)}/s`)
			if (image.downloadedMb !== undefined && image.sizeMb) {
				const secondsRemaining = (image.sizeMb - image.downloadedMb) / rateMbPerSec
				if (secondsRemaining > 0) {
					parts.push(t('machines.install-download-time-remaining', {time: secondsToEta(secondsRemaining)}))
				}
			}
		}
		status = parts.join(' · ')
	}

	return (
		<div className='absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black md:gap-5'>
			<OsIcon osId={machine.osId} state={machine.state} className='size-12 md:size-16' />
			<div className='flex flex-col items-center gap-3'>
				<div className='w-32'>
					<Progress value={machine.installProgress ?? 0} />
				</div>
				<span className='px-6 text-center text-12 -tracking-2 text-white/35'>{status}</span>
			</div>
		</div>
	)
}

function StoppedScreen({machine}: {machine: Machine}) {
	const {start} = useMachineActions()

	return (
		<div className='absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black'>
			<Power className='size-8 text-white/25' />
			<span className='text-13 -tracking-2 text-white/40'>{t('machines.machine-off')}</span>
			<button onClick={() => start({id: machine.id})} className={screenActionButtonClass}>
				{t('machines.turn-on')}
			</button>
		</div>
	)
}

// A machine that failed to install/boot: shows the failure message and a
// one-click recovery (the backend allows start from 'error'). The force-stop
// escape hatch lives in the rail/menu.
function ErrorScreen({machine}: {machine: Machine}) {
	const {start, retryInstall} = useMachineActions()
	const retryingInstall = machine.installPending

	return (
		<div className='absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center'>
			<TbAlertTriangleFilled className={cn('size-8', machineStopTextClass)} />
			<div className='flex flex-col gap-1.5'>
				<span className='text-15 font-medium -tracking-2 text-white'>{t('machines.error-title')}</span>
				{machine.errorMessage && (
					<span className='max-w-sm text-13 -tracking-2 text-white/50 select-text'>
						{getMachinesErrorMessage(machine.errorMessage)}
					</span>
				)}
			</div>
			<button
				onClick={() => (retryingInstall ? retryInstall({id: machine.id}) : start({id: machine.id}))}
				className={screenActionButtonClass}
			>
				{retryingInstall ? t('machines.retry-install') : t('machines.turn-on-again')}
			</button>
		</div>
	)
}
