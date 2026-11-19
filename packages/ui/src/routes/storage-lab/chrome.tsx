// Storage lab: the lab's own chrome. Always the same pill, so it never reads as part of the
// design: bottom left on a desktop. On a phone the bottom edge belongs to the screen's own
// buttons, so it shrinks into the margin above the window, clear of the title.
//
// Storage Manager is a real umbrelOS window, which keeps the pointer and the focus to itself.
// The chrome takes its pointer back and keeps its clicks from reaching the window, which
// would otherwise close.

import {TbFlask} from 'react-icons/tb'
import {Link} from 'react-router-dom'

const outsideWindow = {
	'data-lab': true,
	// Radix switches the pointer off for everything outside an open window
	style: {pointerEvents: 'auto'} as const,
	// and closes the window when something outside it is pressed
	onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
}

export function LabBar({title, children}: {title: string; children?: React.ReactNode}) {
	return (
		<div
			{...outsideWindow}
			className='fixed top-0.5 left-1 z-[70] flex max-w-[calc(100vw-8px)] items-center gap-0.5 rounded-full border border-white/15 bg-black/75 p-0.5 text-11 text-white/80 shadow-lg backdrop-blur-md md:top-auto md:bottom-4 md:left-4 md:gap-1 md:p-1 md:text-12'
		>
			<Link
				to='/storage-lab'
				className='flex items-center gap-1 rounded-full px-2 py-px font-medium text-white/90 transition-colors hover:bg-white/15 md:gap-1.5 md:px-2.5 md:py-1'
			>
				<TbFlask className='size-3.5' />
				Lab
			</Link>
			<span className='hidden truncate pr-2 text-white/50 md:block'>{title}</span>
			{children}
		</div>
	)
}

export const labButtonClass =
	'shrink-0 rounded-full bg-white/12 px-2 py-px font-medium text-white/90 transition-colors hover:bg-white/20 outline-hidden focus-visible:ring-2 focus-visible:ring-white/40 md:px-2.5 md:py-1'

export const labChipClass =
	'rounded-full bg-white/10 px-2.5 py-1 text-12 text-white/85 outline-hidden transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/40 aria-pressed:bg-white/85 aria-pressed:text-black'

// The panel the lab's menus open in
export function LabPanel({title, onClose, children}: {title: string; onClose: () => void; children: React.ReactNode}) {
	return (
		<div
			{...outsideWindow}
			className='fixed top-8 left-1 z-[70] flex max-h-[72svh] w-[340px] max-w-[calc(100vw-8px)] flex-col gap-4 overflow-y-auto rounded-2xl border border-white/15 bg-black/85 p-4 text-13 text-white/80 shadow-2xl backdrop-blur-xl md:top-auto md:bottom-16 md:left-4'
		>
			<div className='flex items-center justify-between'>
				<span className='font-semibold text-white/90'>{title}</span>
				<button
					type='button'
					onClick={onClose}
					className='rounded-full px-2 py-0.5 text-12 text-white/50 outline-hidden hover:text-white focus-visible:ring-2 focus-visible:ring-white/40'
				>
					Close
				</button>
			</div>
			{children}
		</div>
	)
}

export function LabGroup({label, children}: {label: string; children: React.ReactNode}) {
	return (
		<div className='flex flex-col gap-2'>
			<span className='text-12 text-white/45'>{label}</span>
			{children}
		</div>
	)
}

// One of a set of choices in a lab menu
export function LabChips<T extends string>({
	options,
	value,
	onChange,
}: {
	options: readonly {id: T; label: string}[]
	value: T
	onChange: (value: T) => void
}) {
	return (
		<div className='flex flex-wrap gap-1.5'>
			{options.map((option) => (
				<button
					key={option.id}
					type='button'
					aria-pressed={value === option.id}
					className={labChipClass}
					onClick={() => onChange(option.id)}
				>
					{option.label}
				</button>
			))}
		</div>
	)
}
