import {Minus, Plus} from 'lucide-react'
import {useId} from 'react'

import {cn} from '@/lib/utils'

// Shared building blocks of the machine spec-sheet forms (create + settings)

// Round −/+ controls with the current value between them; pass `middle` to
// swap the read-only value for an editable field (e.g. the storage input)
export function Stepper({
	display,
	middle,
	onStep,
	canDecrement,
	canIncrement,
	decrementLabel,
	incrementLabel,
	disabled,
}: {
	display?: string
	middle?: React.ReactNode
	onStep: (direction: 1 | -1) => void
	canDecrement: boolean
	canIncrement: boolean
	decrementLabel: string
	incrementLabel: string
	disabled?: boolean
}) {
	const stepButton =
		'grid size-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5'
	return (
		<div className='flex items-center gap-2 sm:gap-3'>
			<button
				type='button'
				className={stepButton}
				disabled={disabled || !canDecrement}
				onClick={() => onStep(-1)}
				aria-label={decrementLabel}
			>
				<Minus className='size-3.5' aria-hidden />
			</button>
			{middle ?? (
				<span className='w-24 text-center text-15 font-medium -tracking-2 text-white tabular-nums'>{display}</span>
			)}
			<button
				type='button'
				className={stepButton}
				disabled={disabled || !canIncrement}
				onClick={() => onStep(1)}
				aria-label={incrementLabel}
			>
				<Plus className='size-3.5' aria-hidden />
			</button>
		</div>
	)
}

export function SpecRow({
	label,
	note,
	wide,
	children,
}: {
	label: string
	note?: string
	/** A long value (a product key): the control drops under the label until the
	 * spec list (an @container) has room for both side by side */
	wide?: boolean
	children: React.ReactNode
}) {
	const labelId = useId()

	return (
		<div
			role='group'
			aria-labelledby={labelId}
			className={cn(
				'flex justify-between gap-4 py-5 sm:gap-6',
				wide ? 'flex-col @[30rem]:flex-row @[30rem]:items-center' : 'items-center',
			)}
		>
			<div className='flex min-w-0 flex-1 flex-col gap-1'>
				<span id={labelId} className='text-15 font-medium -tracking-2 text-white'>
					{label}
				</span>
				{note && <span className='max-w-[280px] text-12 leading-snug -tracking-2 text-white/35'>{note}</span>}
			</div>
			<div className='shrink-0'>{children}</div>
		</div>
	)
}
