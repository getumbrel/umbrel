import {Disc3, Loader2, MoreHorizontal, Pin, PinOff, Power, RotateCw, Settings, Square, Trash2} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {useNavigate} from 'react-router-dom'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {Progress} from '@/components/ui/progress'
import {toast} from '@/components/ui/toast'
import {machineIconSrc, OsIcon} from '@/features/machines/components/os-icon'
import {
	getOsVisuals,
	layoutMorphTransition,
	machinePath,
	machineRowButtonClass,
	machineStopTextClass,
} from '@/features/machines/constants'
import {getMachinesErrorMessage, useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import type {Machine} from '@/features/machines/types'
import {isMachineStartable, prettyMbPair} from '@/features/machines/utils'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation'
import {t} from '@/utils/i18n'

export default function MachinesList({machines}: {machines: Machine[]}) {
	const running = machines.filter((machine) => machine.state === 'running').length

	return (
		<div className='flex flex-col gap-3 p-6 md:p-12'>
			<div className='flex items-baseline justify-between'>
				<h2 className='text-17 font-semibold -tracking-2 text-white/85'>{t('machines.all-machines')}</h2>
				<span className='text-13 -tracking-2 text-white/35 tabular-nums'>
					{t('machines.running-summary', {running, total: machines.length})}
				</span>
			</div>
			<div className='grid grid-cols-1 gap-3 lg:grid-cols-2'>
				<AnimatePresence mode='popLayout' initial={true}>
					{machines.map((machine, i) => (
						<MachineRow key={machine.id} machine={machine} index={i} />
					))}
				</AnimatePresence>
			</div>
		</div>
	)
}

// The living glow behind the monitor: breathes in the OS brand color while the
// machine runs, holds a faint ember while it works, goes red on error, and
// almost disappears when it sleeps. With no state pill on the row, this light
// (plus the artwork itself) is the primary state channel.
function MonitorGlow({machine}: {machine: Machine}) {
	const {color} = getOsVisuals(machine.osId)
	const settingUp =
		machine.installationState === 'setting-up' ||
		(machine.installationState === 'setup-delayed' && machine.state === 'running')
	const running = machine.state === 'running' && !settingUp
	const isError = machine.state === 'error'
	const working =
		settingUp || machine.state === 'installing' || machine.state === 'starting' || machine.state === 'restarting'

	return (
		<motion.div
			aria-hidden
			className='absolute inset-1 rounded-full blur-2xl'
			style={{backgroundColor: isError ? '#f63636' : color}}
			animate={running ? {opacity: [0.42, 0.62, 0.42]} : {opacity: working ? 0.3 : isError ? 0.25 : 0.08}}
			transition={running ? {duration: 4, repeat: Infinity, ease: 'easeInOut'} : {duration: 0.6}}
		/>
	)
}

function MachineRow({machine, index}: {machine: Machine; index: number}) {
	const navigate = useNavigate()
	const isError = machine.state === 'error'
	const setupDelayed = machine.installationState === 'setup-delayed' && machine.state === 'running'
	const settingUp = machine.installationState === 'setting-up' || setupDelayed
	const iconState = settingUp ? 'installing' : machine.state

	// Compact "used of total" storage pair, e.g. "4.2 of 15 GB"
	const {downloaded: storageUsed, total: storageTotal} = prettyMbPair(
		machine.storageUsedGb * 1_000,
		machine.diskSizeGb * 1_000,
	)

	// Status after the version dot — working states narrate right here with a
	// trailing ellipsis; only error owns the detail slot instead.
	// Keys stay literal for the translation updater.
	const statusLabel = setupDelayed
		? `${t('machines.state.setup-delayed')}…`
		: settingUp
			? `${t('machines.state.setting-up')}…`
			: machine.state === 'running'
				? t('machines.state.running')
				: machine.state === 'suspended'
					? t('machines.state.suspended')
					: machine.state === 'stopped'
						? t('machines.state.stopped')
						: machine.state === 'installing'
							? `${t('machines.state.installing')}…`
							: machine.state === 'starting'
								? `${t('machines.state.starting')}…`
								: machine.state === 'stopping'
									? `${t('machines.state.stopping')}…`
									: machine.state === 'restarting'
										? `${t('machines.state.restarting')}…`
										: undefined

	return (
		// Non-interactive container: the primary open affordance is a real button
		// (activates on Enter *and* Space) whose stretched ::after covers the row,
		// while the action buttons sit above it in their own z-layer.
		<motion.div
			// Rows glide to their new spot when a sibling is added/removed
			// (position-only: row size never changes, so no scale distortion)
			layout='position'
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			exit={{opacity: 0}}
			transition={{delay: index * 0.02, duration: 0.2, ease: 'easeOut', ...layoutMorphTransition}}
			className={cn(
				// settings-edge-material: same card surface as the Settings page tiles.
				// Below sm the row becomes a centered column — monitor on top, copy
				// beneath, controls at the bottom — since the horizontal layout can't
				// fit a name, status, and two controls on a phone-width card.
				'settings-edge-material relative flex flex-col items-center gap-3 rounded-24 bg-white/5 p-5 transition-colors duration-300 hover:bg-white/8 sm:flex-row sm:gap-4 sm:p-4',
				isError && 'border border-[#f63636]/40 bg-[#f63636]/[0.08] hover:bg-[#f63636]/[0.12]',
			)}
		>
			<button
				type='button'
				onClick={() => navigate(machinePath(machine.id))}
				className='flex w-full min-w-0 cursor-pointer flex-col items-center gap-3 text-center after:absolute after:inset-0 after:rounded-24 focus:outline-hidden focus-visible:after:ring-3 focus-visible:after:ring-white/20 sm:flex-1 sm:flex-row sm:gap-4 sm:text-left'
			>
				<div className='relative shrink-0'>
					<MonitorGlow machine={machine} />
					<OsIcon osId={machine.osId} state={iconState} className='relative size-24 sm:size-20' />
					{/* Mobile only: the catalog tiles' monitor reflection off the card
					    surface (the copy column below is `relative` to paint above it) */}
					<div
						aria-hidden
						className='pointer-events-none absolute top-24 left-1/2 h-14 w-24 -translate-x-1/2 sm:hidden'
					>
						<div className='[mask-image:linear-gradient(to_bottom,black,transparent_75%)] opacity-[0.08] blur-[2px]'>
							<OsIcon osId={machine.osId} state={iconState} className='size-24 -scale-y-100' />
						</div>
					</div>
				</div>
				<div className='relative flex w-full min-w-0 flex-col items-center gap-1.5 sm:flex-1 sm:items-start'>
					{/* No state pill: the artwork, glow, detail line and power button
					    already tell the whole story */}
					<span className='max-w-full min-w-0 truncate text-15 font-medium -tracking-2 text-white'>{machine.name}</span>
					{/* Truncate the whole line: a non-shrinking status can otherwise
					    paint outside the copy column and underneath the controls. */}
					<div className='w-full min-w-0 truncate text-center text-12 -tracking-2 text-white/40 sm:text-left'>
						{machine.osVersion}
						{statusLabel && (
							<>
								<span className='mx-1.5 inline-block size-[3px] rounded-full bg-white/25 align-middle' />
								{statusLabel}
							</>
						)}
					</div>
					{/* Detail slot: quiet specs everywhere (installing included, for
					    consistency across the grid — the island carries the progress);
					    only error narrates here */}
					<div className='flex h-5 w-full items-center justify-center overflow-hidden sm:justify-start'>
						{isError ? (
							<span className='min-w-0 truncate text-12 -tracking-2 text-[#f63636]/80'>
								{machine.errorMessage ? getMachinesErrorMessage(machine.errorMessage) : t('machines.error-title')}
							</span>
						) : (
							<span className='truncate text-12 -tracking-2 text-white/30 tabular-nums'>
								{t('machines.cores-count', {count: machine.cores})} · {t('machines.gb', {value: machine.memoryGb})} ·{' '}
								{t('machines.storage-used-of-total', {used: storageUsed, total: storageTotal})}
							</span>
						)}
					</div>
				</div>
			</button>
			{/* Two controls, not three: restart lives in the menu. The reclaimed
			    width goes to the name and detail line. */}
			<div className='relative z-10 flex shrink-0 items-center gap-2 sm:gap-1.5'>
				<MachineMenu machine={machine} withRestart />
				<MachinePowerButton machine={machine} />
			</div>
		</motion.div>
	)
}

function MachinePowerButton({machine}: {machine: Machine}) {
	const {start, stop, retryInstall} = useMachineActions()

	if (machine.state === 'running') {
		return (
			<DarkTooltip label={t('machines.shut-down')}>
				<button
					className={machineRowButtonClass}
					onClick={() => stop({id: machine.id})}
					aria-label={t('machines.shut-down')}
				>
					<Power className={cn('size-4 md:size-5', machineStopTextClass)} />
				</button>
			</DarkTooltip>
		)
	}

	// Stopped, suspended, and error states get a one-click start. Starting a
	// suspended guest first resets it so libvirt can boot it normally.
	if (isMachineStartable(machine.state)) {
		const retryingInstall = machine.state === 'error' && machine.installPending
		const label = retryingInstall
			? t('machines.retry-install')
			: machine.state === 'error'
				? t('machines.turn-on-again')
				: t('machines.turn-on')
		return (
			<DarkTooltip label={label}>
				<button
					className={machineRowButtonClass}
					onClick={() => (retryingInstall ? retryInstall({id: machine.id}) : start({id: machine.id}))}
					aria-label={label}
				>
					<Power className='size-4 md:size-5' />
				</button>
			</DarkTooltip>
		)
	}

	return (
		<button className={machineRowButtonClass} disabled>
			<Loader2 className='size-4 animate-spin md:size-5' />
		</button>
	)
}

// Uninstall confirmation flow, shared by the list menu and the rail's
// "Cancel install" affordance (uninstall doubles as cancel-install).
export function useUninstallMachine(machine: Machine) {
	const confirm = useConfirmation()
	const {uninstall} = useMachineActions()

	// The machine's own error artwork (red power light, glitched screen) sets
	// the destructive tone better than a generic warning triangle
	const ErrorArtIcon = () => (
		<img
			src={machineIconSrc(machine.osId, 'error')}
			alt=''
			draggable={false}
			className='mx-auto size-14 object-contain'
		/>
	)

	return async () => {
		try {
			const {actionValue} = await confirm({
				title: t('machines.uninstall-confirm-title', {name: machine.name}),
				message: t('machines.uninstall-confirm-message'),
				icon: ErrorArtIcon,
				actions: [
					{label: t('machines.uninstall'), value: 'uninstall', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (actionValue === 'uninstall') await uninstall({id: machine.id})
		} catch {
			// User dismissed the dialog
		}
	}
}

function useEjectInstallMedia(machine: Machine) {
	const confirm = useConfirmation()
	const {ejectInstallMedia} = useMachineActions()

	return async () => {
		try {
			const {actionValue} = await confirm({
				title: t('machines.eject-install-media-confirm-title'),
				message: t('machines.eject-install-media-confirm-message'),
				actions: [
					{label: t('machines.eject-install-media'), value: 'eject', variant: 'default'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (actionValue !== 'eject') return
			await ejectInstallMedia({id: machine.id})
			toast.success(t('machines.install-media-ejected'), {area: 'machines'})
		} catch {
			// User dismissed the dialog or the mutation's onError toast owns the failure.
		}
	}
}

export function MachineMenu({
	machine,
	buttonClassName,
	tooltipSide,
	withRestart,
}: {
	machine: Machine
	buttonClassName?: string
	tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
	// The list rows have no dedicated restart button, so their menu carries it.
	// The rail keeps its own restart button and leaves this off.
	withRestart?: boolean
}) {
	const navigate = useNavigate()
	const {setPinned, forceStop, restart} = useMachineActions()
	const handleUninstall = useUninstallMachine(machine)
	const handleEjectInstallMedia = useEjectInstallMedia(machine)

	const storagePercent = machine.diskSizeGb > 0 ? (machine.storageUsedGb / machine.diskSizeGb) * 100 : 0
	// Compact "used/total" pair, e.g. "2.57/4 GB" (or "350 MB/4 GB" below a gig)
	const {downloaded: storageUsed, total: storageTotal} = prettyMbPair(
		machine.storageUsedGb * 1_000,
		machine.diskSizeGb * 1_000,
	)

	return (
		<DropdownMenu>
			<DarkTooltip label={t('machines.machine-options')} side={tooltipSide}>
				<DropdownMenuTrigger asChild>
					<button className={buttonClassName ?? machineRowButtonClass} aria-label={t('machines.machine-options')}>
						<MoreHorizontal className='size-4 md:size-5' />
					</button>
				</DropdownMenuTrigger>
			</DarkTooltip>
			{/* p-1: match the homescreen context menu's tight padding */}
			<DropdownMenuContent align='start' className='w-60 p-1'>
				{/* Block cards share the menu items' radius so they nest concentrically
				    inside the 20px menu surface at its p-1 inset */}
				<div className='mb-1 flex flex-col gap-2 rounded-[var(--material-item-radius)] bg-white/8 p-3'>
					<div className='flex items-center justify-between'>
						<span className='text-13 font-medium -tracking-2 text-white'>{t('machines.storage')}</span>
						<span className='text-11 font-semibold text-white'>
							{storageUsed}
							<span className='text-white/40'> / {storageTotal}</span>
						</span>
					</div>
					<Progress value={storagePercent} size='thicker' variant='primary' />
				</div>
				{machine.performanceWarning && (
					<div className='mb-1 rounded-[var(--material-item-radius)] border border-amber-400/20 bg-amber-400/10 p-3 text-12 leading-snug text-amber-200/90'>
						{machine.performanceWarning}
					</div>
				)}
				<DropdownMenuItem
					className='gap-2 whitespace-nowrap'
					onSelect={() => navigate(`${machinePath(machine.id)}/settings`)}
				>
					<Settings className='size-4 shrink-0' />
					{t('machines.settings')}
				</DropdownMenuItem>
				<DropdownMenuItem
					className='gap-2 whitespace-nowrap'
					onSelect={() => setPinned({id: machine.id, pinned: !machine.pinned})}
				>
					{machine.pinned ? <PinOff className='size-4 shrink-0' /> : <Pin className='size-4 shrink-0' />}
					{machine.pinned ? t('machines.unpin-from-homescreen') : t('machines.pin-to-homescreen')}
				</DropdownMenuItem>
				{machine.installationMediaAttached && !machine.firstBootSetup && machine.state !== 'installing' && (
					<DropdownMenuItem className='gap-2 whitespace-nowrap' onSelect={handleEjectInstallMedia}>
						<Disc3 className='size-4 shrink-0' />
						{t('machines.eject-install-media')}
					</DropdownMenuItem>
				)}
				{withRestart && machine.state === 'running' && (
					<DropdownMenuItem className='gap-2 whitespace-nowrap' onSelect={() => restart({id: machine.id})}>
						<RotateCw className='size-4 shrink-0' />
						{t('machines.restart')}
					</DropdownMenuItem>
				)}
				{/* Force stop: the escape hatch for any non-stopped state — except
				   'installing', where "Cancel install" (uninstall) is the right action */}
				{machine.state !== 'stopped' && machine.state !== 'installing' && (
					<DropdownMenuItem
						className='gap-2 whitespace-nowrap text-destructive2-lightest focus:text-destructive2-lightest data-[highlighted]:text-destructive2-lightest'
						onSelect={() => forceStop({id: machine.id})}
					>
						<Square className='size-4 shrink-0 fill-current' />
						{t('machines.force-shut-down')}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem
					className='gap-2 whitespace-nowrap text-destructive2-lightest focus:text-destructive2-lightest data-[highlighted]:text-destructive2-lightest'
					onSelect={handleUninstall}
				>
					<Trash2 className='size-4 shrink-0' />
					{t('machines.uninstall')}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
