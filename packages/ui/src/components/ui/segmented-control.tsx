import {motion} from 'framer-motion'
import {useId} from 'react'

import {cn} from '@/shadcn-lib/utils'

type Tab = {id: string; label: string}

// Based on:
// https://buildui.com/recipes/animated-tabs
export function SegmentedControl({
	value,
	onValueChange,
	size = 'default',
	variant = 'default',
	tabs,
}: {
	value: string
	onValueChange: (value: string) => void
	size?: 'default' | 'lg'
	variant?: 'default' | 'primary'
	tabs: Tab[]
}) {
	const id = useId()
	return (
		<div
			className={cn(
				'flex gap-0 rounded-full border-[0.5px] border-white/10 bg-white/3 text-12',
				size === 'default' && 'h-[30px] p-1',
				size === 'lg' && 'h-[40px] p-[5px]',
			)}
		>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					className={cn(
						'group relative flex-grow rounded-full leading-inter-trimmed outline-none focus-visible:ring-3 focus-visible:ring-brand/40',
						size === 'default' && 'px-2.5',
						size === 'lg' && 'px-[14px]',
					)}
					disabled={value === tab.id}
					onClick={() => onValueChange(tab.id)}
				>
					{value === tab.id && (
						<motion.span
							layoutId={id}
							className={cn(
								'absolute inset-0 z-10 rounded-full',
								variant === 'default' && 'bg-white/10',
								variant === 'primary' && 'bg-brand',
							)}
							transition={{type: 'spring', bounce: 0.2, duration: 0.4}}
						/>
					)}
					<span
						className={cn(
							'relative z-10 transition-opacity duration-200',
							size === 'lg' && 'font-medium',
							value !== tab.id && 'opacity-50 group-hover:opacity-70',
						)}
					>
						{tab.label}
					</span>
				</button>
			))}
		</div>
	)
}
