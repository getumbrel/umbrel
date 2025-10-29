import React, {MouseEventHandler} from 'react'
import {IconType} from 'react-icons'
import {useMount} from 'react-use'

import {cn} from '@/shadcn-lib/utils'

export function ListRow({
	title,
	description,
	children,
	isActive = false,
	isLabel = false,
	disabled,
	onClick,
}: {
	title: string
	description: React.ReactNode
	children?: React.ReactNode
	isActive?: boolean
	isLabel?: boolean
	disabled?: boolean
	onClick?: MouseEventHandler
}) {
	const El = isLabel ? 'label' : 'div'
	const ref = React.useRef<any>(null)

	useMount(() => {
		if (!isActive) return
		// ref.current?.scrollIntoView({behavior: 'smooth'})
		ref.current?.focus()
	})

	return (
		<El
			// Allow being focused if active
			tabIndex={isActive ? 0 : -1}
			ref={ref}
			className={cn(
				'flex items-center justify-between gap-x-4 gap-y-2.5 py-4 outline-none',
				// Show hover effect by default
				'bg-gradient-to-r from-transparent to-transparent hover:via-white/4',
				// Make it clickable if it's a label
				isLabel && 'cursor-pointer active:via-white/3',
				// TODO: also scroll into view if active
				isActive && 'umbrel-pulse-a-few-times',
				disabled && 'pointer-events-none opacity-50',
			)}
			onClick={onClick}
		>
			<div className='flex min-w-0 flex-1 flex-col gap-1'>
				<h3 className='text-14 font-medium leading-none -tracking-2'>{title}</h3>
				<p className='text-12 leading-tight -tracking-2 text-white/40'>{description}</p>
			</div>
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
}: {
	icon: IconType
	title: React.ReactNode
	description: React.ReactNode
	children?: React.ReactNode
	onClick?: () => void
}) {
	const Icon = icon

	return (
		<button className={cn('flex w-full items-center gap-x-4 gap-y-2.5 px-2.5 py-3 text-left')} onClick={onClick}>
			<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-6 bg-white/6'>
				{Icon && <Icon className={cn('h-5 w-5 text-brand [&>*]:stroke-2')} />}
			</div>
			<div className='flex min-w-0 flex-col gap-1'>
				<h3 className='text-13 font-medium leading-none -tracking-2'>{title}</h3>
				<p className='truncate text-12 leading-none -tracking-2 text-white/40'>{description}</p>
			</div>
			{children}
		</button>
	)
}
