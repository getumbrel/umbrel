import {ChevronLeft, ChevronRight} from 'lucide-react'
import type {ComponentType} from 'react'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {machineRailButtonClass} from '@/features/machines/constants'
import {cn} from '@/lib/utils'

// The Machines console rail's control, reused as-is so the two feel like one system
export const lightboxButtonClass = machineRailButtonClass

export function LightboxButton({
	icon: Icon,
	label,
	active = false,
	side = 'bottom',
	className,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	icon: ComponentType<{className?: string}>
	label: string
	active?: boolean
	// Where the tooltip goes; the upload island sits at the screen's bottom
	// edge, so its tooltips point up instead
	side?: 'top' | 'bottom' | 'left' | 'right'
}) {
	return (
		<DarkTooltip label={label} side={side}>
			<button
				type='button'
				aria-label={label}
				aria-pressed={active || undefined}
				className={cn(lightboxButtonClass, active && 'bg-white/20 hover:bg-white/25', className)}
				{...props}
			>
				<Icon className='size-5' />
			</button>
		</DarkTooltip>
	)
}

// Edge arrows: present for the pointer, quiet until the stage is hovered
export function StageArrow({
	side,
	label,
	disabled,
	onClick,
}: {
	side: 'left' | 'right'
	label: string
	disabled: boolean
	onClick: () => void
}) {
	const Icon = side === 'left' ? ChevronLeft : ChevronRight
	return (
		<button
			type='button'
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				'absolute top-1/2 z-[5] flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:text-white focus-visible:opacity-100 disabled:!opacity-0',
				side === 'left' ? 'left-3' : 'right-3',
			)}
		>
			<Icon className='size-5' />
		</button>
	)
}
