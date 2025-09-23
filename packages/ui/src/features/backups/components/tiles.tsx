import {Loader2} from 'lucide-react'
import * as React from 'react'

import {RadioGroupItem} from '@/shadcn-components/ui/radio-group'

export function SelectableTile({
	children,
	selected,
	onClick,
}: {
	children: React.ReactNode
	selected?: boolean
	onClick?: () => void
}) {
	return (
		<div
			className={[
				'flex h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl p-4 text-center',
				selected ? 'border border-brand bg-brand/15' : 'border border-white/10 bg-white/5 hover:bg-white/10',
			].join(' ')}
			onClick={onClick}
		>
			{children}
		</div>
	)
}

export function ClickableTile({children, onClick}: {children: React.ReactNode; onClick?: () => void}) {
	return (
		<div
			className='flex h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl border border-white/10 bg-white/5 p-4 text-center hover:bg-white/10'
			onClick={onClick}
		>
			{children}
		</div>
	)
}

export function LoadingTile() {
	return (
		<div className='flex h-[120px] items-center justify-center rounded-xl border border-white/10 bg-white/5'>
			<Loader2 className='h-6 w-6 animate-spin opacity-60' />
		</div>
	)
}

export function EmptyTile({text}: {text: string}) {
	return (
		<div className='flex h-[120px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm opacity-60'>
			{text}
		</div>
	)
}

export function RadioTile({
	value,
	selected,
	title,
	children,
	onSelect,
}: {
	value: string
	selected: boolean
	title: string
	children?: React.ReactNode
	onSelect?: () => void
}) {
	return (
		<div
			role='button'
			tabIndex={0}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					onSelect?.()
				}
			}}
			className={[
				'flex cursor-pointer items-center gap-3 rounded-xl border p-4',
				selected ? 'border-brand bg-brand/15' : 'border-white/10 bg-white/5 hover:bg-white/10',
			].join(' ')}
		>
			<RadioGroupItem id={`radio-${value}`} value={value} />
			<div className='flex-1'>
				<div className='text-sm font-medium'>{title}</div>
				<div className='text-[12px] opacity-60'>{children}</div>
			</div>
		</div>
	)
}
