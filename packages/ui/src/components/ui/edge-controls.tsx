import {Search} from 'lucide-react'
import * as React from 'react'

import {SegmentedControl} from '@/components/ui/segmented-control'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// Controls on the "edge material" surface (`.settings-edge-material`): the raised
// pill language introduced by the Settings page and shared by system apps since.
// Surfaces and states follow the Machines/Photos rail buttons (see
// machineRailButtonClass): a white/6 fill that steps up on hover, white text,
// a light press, one focus ring — so a pill reads as a button, not a label.

type Tab<T extends string> = {id: T; label: string}

// Horizontal filter pills, e.g. Settings categories or the Photos timeline zoom
export function FilterPills<T extends string>({
	value,
	onValueChange,
	tabs,
	ariaLabel,
	className,
}: {
	value: T
	onValueChange: (value: T) => void
	tabs: readonly Tab<T>[]
	ariaLabel: string
	className?: string
}) {
	return (
		<SegmentedControl
			value={value}
			onValueChange={onValueChange}
			tabs={tabs}
			variant='muted-primary'
			ariaLabel={ariaLabel}
			className={cn(
				'settings-edge-material umbrel-hide-scrollbar h-11 min-w-0 shrink gap-1 overflow-x-auto rounded-24 border-0 bg-white/6 p-1.5 text-13 text-white',
				className,
			)}
			tabClassName='flex shrink-0 items-center justify-center px-2.5 pb-0 font-medium -tracking-2 hover:bg-white/10'
		/>
	)
}

export function SearchField({
	value,
	onChange,
	label,
	className,
}: {
	value: string
	onChange: (value: string) => void
	label: string
	className?: string
}) {
	return (
		// A label, so a tap anywhere on the pill, not just on the line of text, goes to the field
		<label
			className={cn(
				'settings-edge-material flex h-11 w-[184px] shrink-0 cursor-text items-center gap-2 overflow-hidden rounded-24 bg-white/6 px-3 text-white/70 transition-colors duration-200 focus-within:bg-white/12 focus-within:text-white hover:bg-white/9',
				className,
			)}
		>
			<Search className='size-4 shrink-0' aria-hidden='true' />
			<input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') onChange('')
				}}
				placeholder={label}
				aria-label={label}
				className='min-w-0 flex-1 bg-transparent text-12 text-white outline-hidden placeholder:text-white/50'
			/>
		</label>
	)
}

const pillButtonClass = tw`settings-edge-material flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-24 bg-white/6 px-4 text-13 font-medium -tracking-2 text-white outline-hidden transition-[background-color,opacity,transform] duration-200 hover:bg-white/12 focus-visible:ring-3 focus-visible:ring-white/20 active:scale-95 disabled:pointer-events-none disabled:opacity-40`

// Pill button matching FilterPills/SearchField height. Pass `icon` for a leading icon;
// omit children (and pass aria-label) for an icon-only button.
export function PillButton({
	icon: Icon,
	className,
	children,
	...props
}: React.ComponentProps<'button'> & {
	icon?: React.ComponentType<{className?: string}>
}) {
	const iconOnly = !children
	return (
		<button type='button' className={cn(pillButtonClass, iconOnly && 'w-11 px-0', className)} {...props}>
			{Icon ? <Icon className='size-4 shrink-0' /> : null}
			{children}
		</button>
	)
}

// Several small actions sharing one pill, e.g. a −/+ stepper
export function PillButtonGroup({className, children, ...props}: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				'settings-edge-material flex h-11 shrink-0 items-center gap-1 rounded-24 bg-white/6 p-1.5',
				className,
			)}
			{...props}
		>
			{children}
		</div>
	)
}

export function PillButtonGroupItem({
	icon: Icon,
	className,
	children,
	...props
}: React.ComponentProps<'button'> & {
	icon?: React.ComponentType<{className?: string}>
}) {
	return (
		<button
			type='button'
			className={cn(
				'flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-2 text-13 font-medium -tracking-2 text-white outline-hidden transition-[background-color,opacity,transform] duration-200 hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-white/20 active:scale-95 disabled:pointer-events-none disabled:opacity-40',
				className,
			)}
			{...props}
		>
			{Icon ? <Icon className='size-4 shrink-0' /> : null}
			{children}
		</button>
	)
}
