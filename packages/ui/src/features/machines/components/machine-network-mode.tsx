import {useId} from 'react'
import type {IconType} from 'react-icons'
import {TbAlertTriangle, TbCircleCheckFilled, TbRouter, TbShieldLock} from 'react-icons/tb'

import {useMachineCapabilities} from '@/features/machines/hooks/use-machines'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

export type MachineNetworkMode = Machine['networkMode']

// Where a machine sits on the network: behind Umbrel on its private machine
// network (the default, works everywhere), or directly on the user's network
// with its own address from the router. Shared by the create form and settings.
//
// Drawn as the same mode cards as Storage mode and onboarding, so both choices
// stay on screen with what each one means. An option that can't be used keeps
// its text and says what it needs in place of the checkmark.
export function MachineNetworkModeRow({
	value,
	onChange,
	disabled,
	savedMode,
	footer,
}: {
	value: MachineNetworkMode
	onChange: (mode: MachineNetworkMode) => void
	disabled?: boolean
	// The mode the machine already has, in settings. Left out on the create form.
	savedMode?: MachineNetworkMode
	// Anything the screen needs to add about the choice, under the note
	footer?: React.ReactNode
}) {
	const {capabilities, isLoading} = useMachineCapabilities()
	const lanBridge = capabilities?.lanBridge
	const lanUnavailable = lanBridge?.available === false
	const labelId = useId()

	// The note under the cards only speaks up when something needs saying: a
	// machine stuck on a network it can't join, or the one-time reconnect
	const note =
		value === 'bridged' && lanUnavailable ? (
			<p className='flex gap-2 rounded-12 border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-12 leading-snug -tracking-2 text-amber-100/85'>
				<TbAlertTriangle className='mt-px size-4 shrink-0 text-amber-300/90' />
				{lanBridge.reason === 'wifi'
					? t('machines.network-lan-cant-start-wifi')
					: t('machines.network-lan-cant-start-no-ethernet')}
			</p>
		) : value === 'bridged' && savedMode !== 'bridged' ? (
			<p className='px-1 text-12 leading-snug -tracking-2 text-white/40'>{t('machines.network-lan-reconnect-note')}</p>
		) : null

	return (
		<div className='flex flex-col gap-3 py-5'>
			<span id={labelId} className='text-15 font-medium -tracking-2 text-white'>
				{t('machines.network-access')}
			</span>
			<div role='radiogroup' aria-labelledby={labelId} className='@container'>
				<div className='grid gap-2 rounded-24 bg-white/5 p-2 @xl:grid-cols-2'>
					<NetworkModeCard
						icon={TbShieldLock}
						title={t('machines.network-private')}
						description={t('machines.network-private-description')}
						selected={value === 'nat'}
						disabled={disabled}
						onSelect={() => onChange('nat')}
					/>
					<NetworkModeCard
						icon={TbRouter}
						title={t('machines.network-lan')}
						description={t('machines.network-lan-description')}
						selected={value === 'bridged'}
						// A machine that's already on the LAN can always be switched back,
						// so its card stays selectable even when bridging isn't possible
						unavailableReason={lanUnavailable && value !== 'bridged' ? t('machines.network-needs-ethernet') : undefined}
						// Until the check answers, don't offer a choice that may not work
						disabled={disabled || (isLoading && value !== 'bridged')}
						onSelect={() => onChange('bridged')}
					/>
				</div>
			</div>
			{note}
			{footer}
		</div>
	)
}

function NetworkModeCard({
	icon: Icon,
	title,
	description,
	selected,
	unavailableReason,
	disabled,
	onSelect,
}: {
	icon: IconType
	title: string
	description: string
	selected: boolean
	unavailableReason?: string
	disabled?: boolean
	onSelect: () => void
}) {
	const inert = disabled || unavailableReason !== undefined
	return (
		<button
			type='button'
			role='radio'
			aria-checked={selected}
			onClick={onSelect}
			disabled={inert}
			className={cn(
				'flex flex-col gap-1.5 rounded-17 border px-4 py-3 text-left transition-colors',
				selected ? 'border-brand bg-brand/15' : 'border-transparent',
				!selected && !inert && 'hover:bg-white/4',
				// Form-wide disabled (creating, saving, installing) dims the choice;
				// an unavailable option stays fully legible
				disabled && unavailableReason === undefined && !selected && 'opacity-50',
			)}
		>
			<span className='flex w-full items-center gap-2'>
				<Icon className={cn('size-5 shrink-0', selected ? 'text-white' : 'text-white/80')} />
				<span className={cn('text-15 font-semibold -tracking-2', selected ? 'text-white' : 'text-white/80')}>
					{title}
				</span>
				<span className='ml-auto flex shrink-0 items-center'>
					{selected && <TbCircleCheckFilled className='size-5 text-brand' />}
					{unavailableReason && (
						<span className='rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-white/50'>
							{unavailableReason}
						</span>
					)}
				</span>
			</span>
			<span className='text-13 leading-snug font-medium -tracking-2 text-pretty text-white/60'>{description}</span>
		</button>
	)
}
