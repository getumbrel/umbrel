import {motion} from 'framer-motion'
import {useId} from 'react'

import {cn} from '@/shadcn-lib/utils'

type Tab<T extends string> = {id: T; label: string}

// Based on:
// https://buildui.com/recipes/animated-tabs
export function SegmentedControl<T extends string>({
	value,
	onValueChange,
	size = 'default',
	variant = 'default',
	tabs,
}: {
	value?: T
	onValueChange: (value: T) => void
	size?: 'default' | 'lg' | 'sm'
	variant?: 'default' | 'primary'
	tabs: readonly Tab<T>[]
}) {
	// When layout shifts, we don't want the layout animation to play
	const id = useId()

	const justTwo = tabs.length === 2

	return (
		<motion.div
			// `layoutRoot` to prevent it from animating when the layout shifts
			layoutRoot
			className={cn(
				'flex shrink-0 gap-0 rounded-full border-[0.5px] border-white/6 bg-white/3',
				justTwo && value !== undefined && 'cursor-pointer',
				size === 'sm' && 'h-[24px] p-1 text-[9px]',
				size === 'default' && 'h-[30px] p-1 text-12',
				size === 'lg' && 'h-[40px] p-[5px] text-12',
			)}
			onClick={() => {
				if (justTwo && value !== undefined) {
					if (value === tabs[0].id) {
						onValueChange(tabs[1].id)
					} else {
						onValueChange(tabs[0].id)
					}
				}
			}}
		>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					className={cn(
						'group relative flex-grow rounded-full leading-inter-trimmed outline-none transition-[box-shadow,background]',
						value === tab.id && variant === 'primary' && 'focus-visible:ring-2 focus-visible:ring-brand/40',
						value !== tab.id && 'outline-1 -outline-offset-2 outline-transparent focus-visible:outline-white/10',
						size === 'sm' && 'px-2',
						size === 'default' && 'px-2.5',
						size === 'lg' && 'px-[14px]',
					)}
					disabled={!justTwo ? value === tab.id : undefined}
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
		</motion.div>
	)
}
