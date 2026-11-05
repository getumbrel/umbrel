import React, {MouseEventHandler} from 'react'
import {IconType} from 'react-icons'
import {useMount} from 'react-use'

import {cn} from '@/lib/utils'

type SettingsRowIcon = IconType | string

function RowIcon({icon, className}: {icon: SettingsRowIcon; className: string}) {
	if (typeof icon === 'string') {
		return <img src={icon} alt='' aria-hidden='true' className={className} />
	}

	const Icon = icon
	return <Icon className={className} />
}

export function SettingsListIcon({
	icon,
	className,
	iconClassName,
}: {
	icon: SettingsRowIcon
	className?: string
	iconClassName?: string
}) {
	return (
		<span
			className={cn(
				'settings-list-icon flex size-[30px] shrink-0 items-center justify-center rounded-8 border border-white/25',
				className,
			)}
		>
			<RowIcon icon={icon} className={cn('size-[15px] text-white', iconClassName)} />
		</span>
	)
}

export function ListRow({
	title,
	description,
	children,
	isActive = false,
	disabled,
	onClick,
	icon,
}: {
	title: React.ReactNode
	description: React.ReactNode
	children?: React.ReactNode
	isActive?: boolean
	disabled?: boolean
	onClick?: MouseEventHandler
	icon?: SettingsRowIcon
}) {
	const El = onClick ? 'button' : 'div'
	const ref = React.useRef<any>(null)
	useMount(() => {
		if (!isActive) return
		// ref.current?.scrollIntoView({behavior: 'smooth'})
		ref.current?.focus()
	})

	return (
		<El
			{...(onClick ? {type: 'button' as const, disabled} : {})}
			// Allow being focused if active
			tabIndex={isActive ? 0 : onClick ? undefined : -1}
			ref={ref}
			className={cn(
				'settings-list-row relative flex min-h-[72px] w-full items-center justify-between gap-x-4 gap-y-2.5 px-5 py-3.5 text-left outline-hidden first:rounded-t-24 last:rounded-b-24',
				'focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-inset',
				'bg-linear-to-r from-transparent to-transparent hover:via-white/4',
				onClick && 'cursor-pointer active:via-white/3',
				isActive && 'umbrel-pulse-a-few-times',
				disabled && 'pointer-events-none opacity-50',
			)}
			onClick={onClick}
		>
			<span className='flex min-w-0 flex-1 items-center gap-2.5'>
				{icon && <SettingsListIcon icon={icon} />}
				<span className='flex min-w-0 flex-1 flex-col gap-1'>
					<span className='text-14 leading-none font-medium -tracking-2 text-white/90'>{title}</span>
					<span className='text-12 leading-tight -tracking-2 text-white/40'>{description}</span>
				</span>
			</span>
			{children}
		</El>
	)
}

export function ListRowMobile({
	icon,
	title,
	description,
	children,
	onClick,
	disabled,
}: {
	icon: SettingsRowIcon
	title: React.ReactNode
	description: React.ReactNode
	children?: React.ReactNode
	onClick?: () => void
	disabled?: boolean
}) {
	const El = onClick ? 'button' : 'div'

	return (
		<El
			{...(onClick ? {type: 'button' as const, disabled} : {})}
			className={cn(
				'settings-list-row flex min-h-[68px] w-full items-center gap-x-2.5 gap-y-2.5 px-4 py-3.5 text-left outline-hidden',
				'focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-inset',
				'bg-linear-to-r from-transparent to-transparent transition-colors hover:via-white/4',
				onClick && !disabled && 'cursor-pointer active:via-white/3',
				disabled && 'pointer-events-none opacity-50',
			)}
			onClick={disabled ? undefined : onClick}
		>
			<SettingsListIcon icon={icon} />
			<span className='flex min-w-0 flex-1 flex-col gap-1'>
				<span className='text-14 leading-none font-medium -tracking-2 text-white/90'>{title}</span>
				<span className='text-12 leading-tight -tracking-2 text-white/40'>{description}</span>
			</span>
			{children && <span className='ml-auto flex shrink-0 items-center'>{children}</span>}
		</El>
	)
}

export function ListRowSwitchIndicator({checked}: {checked: boolean}) {
	return (
		<span
			aria-hidden='true'
			className={cn(
				'inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
				checked ? 'bg-brand' : 'bg-white/10',
			)}
		>
			<span
				className={cn(
					'pointer-events-none block size-4 rounded-full bg-white shadow-lg transition-transform',
					checked ? 'translate-x-4' : 'translate-x-0',
				)}
			/>
		</span>
	)
}
