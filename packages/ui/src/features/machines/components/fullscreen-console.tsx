import {Expand, Loader2, Minimize2, Power, RotateCw, Shrink} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useParams} from 'react-router-dom'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {MachineDisplay} from '@/features/machines/components/machine-display'
import {OsIcon} from '@/features/machines/components/os-icon'
import {machinePath, machineStopTextClass} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachine, useMachinesLiveUpdates} from '@/features/machines/hooks/use-machines'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

const consoleButtonClass = tw`flex size-7 items-center justify-center rounded-full text-white/60 transition-[background-color,color,transform] duration-200 hover:bg-white/10 hover:text-white outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:scale-90 disabled:pointer-events-none disabled:opacity-40`

// Fullscreen console, opened in a new browser tab. Minimal chrome: a slim
// header with the VM identity and power controls, display fills the rest.
export default function FullscreenConsole() {
	const userQ = trpcReact.user.get.useQuery()
	const isOwner = userQ.data?.role === 'owner'
	useMachinesLiveUpdates({enabled: isOwner})
	const {machineId} = useParams<{machineId: string}>()
	const {machine, isLoading} = useMachine(machineId, {enabled: isOwner})
	const {stop, restart} = useMachineActions()
	const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false)

	// Track the real browser Fullscreen API state (Esc/F11 can exit it too)
	useEffect(() => {
		const onChange = () => setIsBrowserFullscreen(!!document.fullscreenElement)
		document.addEventListener('fullscreenchange', onChange)
		return () => document.removeEventListener('fullscreenchange', onChange)
	}, [])

	const toggleBrowserFullscreen = () => {
		if (document.fullscreenElement) document.exitFullscreen()
		else document.documentElement.requestFullscreen()
	}

	// Close this tab if we can, otherwise fall back to the windowed view
	const exitFullscreen = () => {
		window.close()
		window.location.href = machinePath(machineId ?? '')
	}

	if (userQ.isLoading || isLoading) return null

	if (!machine) {
		return (
			<div className='flex h-dvh items-center justify-center bg-black text-13 text-white/50'>
				{t('machines.machine-not-found')}
			</div>
		)
	}

	const isBusy = machine.state === 'starting' || machine.state === 'stopping' || machine.state === 'restarting'

	return (
		<div className='flex h-dvh flex-col bg-black'>
			{/* Three columns, with equal sides so the middle label stays centred: a
			    long machine name truncates in its own column instead of running
			    under the label. Phones have no label, so the name gets the room. */}
			<header className='grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-white/6 bg-[#161616] px-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'>
				<div className='flex min-w-0 items-center gap-2'>
					<OsIcon osId={machine.osId} state={machine.state} className='size-5' />
					<span className='truncate text-13 font-medium -tracking-2 text-white'>{machine.name}</span>
					{machine.acceleration === 'tcg' && (
						<span className='hidden shrink-0 font-mono text-12 -tracking-1 text-white/40 tabular-nums sm:inline'>
							{t('machines.emulated')}
						</span>
					)}
				</div>
				<div className='hidden items-center gap-1.5 sm:flex'>
					<span className='text-13 -tracking-2 text-white/40'>{t('machines.running-on')}</span>
					<img src='/assets/dock/dock-machines.webp' alt='' className='size-4 rounded-4' draggable={false} />
					<span className='text-13 -tracking-2 text-white/70'>{t('machines.umbrel-machines')}</span>
				</div>
				<div className='flex items-center gap-1 justify-self-end'>
					<DarkTooltip label={t('machines.fullscreen')} side='bottom'>
						<button
							className={consoleButtonClass}
							onClick={toggleBrowserFullscreen}
							aria-label={t('machines.fullscreen')}
						>
							{isBrowserFullscreen ? <Shrink className='size-4' /> : <Expand className='size-4' />}
						</button>
					</DarkTooltip>
					<DarkTooltip label={t('machines.exit-fullscreen')} side='bottom'>
						<button className={consoleButtonClass} onClick={exitFullscreen} aria-label={t('machines.exit-fullscreen')}>
							<Minimize2 className='size-4' />
						</button>
					</DarkTooltip>
					<DarkTooltip label={t('machines.restart')} side='bottom'>
						<button
							className={consoleButtonClass}
							onClick={() => restart({id: machine.id})}
							disabled={machine.state !== 'running'}
							aria-label={t('machines.restart')}
						>
							<RotateCw className='size-4' />
						</button>
					</DarkTooltip>
					<DarkTooltip label={isBusy ? t(`machines.state.${machine.state}`) : t('machines.shut-down')} side='bottom'>
						<button
							className={consoleButtonClass}
							onClick={() => stop({id: machine.id})}
							disabled={machine.state !== 'running'}
							aria-label={t('machines.shut-down')}
						>
							{isBusy ? (
								<Loader2 className='size-4 animate-spin' />
							) : (
								<Power className={cn('size-4', machineStopTextClass)} />
							)}
						</button>
					</DarkTooltip>
				</div>
			</header>
			<div className='relative min-h-0 flex-1'>
				<MachineDisplay machine={machine} />
			</div>
		</div>
	)
}
