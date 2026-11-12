import {Plus} from 'lucide-react'

import {cn} from '@/lib/utils'
import {focusRingClass} from '@/utils/element-classes'

export function AddManuallyCard({onClick, label}: {onClick?: () => void; label: string}) {
	return (
		<button
			type='button'
			className={cn(
				'flex h-[110px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/5 p-2 transition-colors hover:border-brand hover:bg-brand/15',
				focusRingClass,
			)}
			onClick={onClick}
		>
			<div className='mb-2 flex size-12 items-center justify-center'>
				<div className='flex size-12 items-center justify-center rounded-full bg-white/10'>
					<div className='flex size-8 items-center justify-center rounded-full bg-white/20'>
						<Plus className='size-4' />
					</div>
				</div>
			</div>
			<span className='w-full text-center text-12 text-white/60' title={label}>
				{label}
			</span>
		</button>
	)
}

export function ServerCard({
	children,
	selected,
	onClick,
}: {
	children: React.ReactNode
	// For a card picked from a set (left out for one that's just an action)
	selected?: boolean
	onClick?: () => void
}) {
	const className = `flex h-[110px] w-full flex-col items-center justify-center rounded-xl p-2 transition-colors ${
		selected ? 'border border-brand bg-brand/15' : 'border border-white/10 bg-white/5 hover:bg-white/10'
	}`

	// Without an action (the loading placeholder) it's just a tile
	if (!onClick) return <div className={className}>{children}</div>

	return (
		<button type='button' aria-pressed={selected} className={cn(className, focusRingClass)} onClick={onClick}>
			{children}
		</button>
	)
}
