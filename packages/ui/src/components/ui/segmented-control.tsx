import {motion} from 'motion/react'
import {useId} from 'react'

import {cn} from '@/lib/utils'

type Tab<T extends string> = {id: T; label: string}

// Based on:
// https://buildui.com/recipes/animated-tabs
export function SegmentedControl<T extends string>({
	value,
	onValueChange,
	size = 'default',
	variant = 'default',
	tabs,
	ariaLabel,
	className,
	tabClassName,
}: {
	value?: T
	onValueChange: (value: T) => void
	size?: 'default' | 'lg' | 'sm'
	variant?: 'default' | 'primary' | 'muted-primary'
	tabs: readonly Tab<T>[]
	ariaLabel?: string
	className?: string
	tabClassName?: string
}) {
	// When layout shifts, we don't want the layout animation to play
	const id = useId()

	const justTwo = tabs.length === 2

	return (
		<motion.div
			// `layoutRoot` to prevent it from animating when the layout shifts
			layoutRoot
			// Account for horizontally scrollable segmented controls when measuring the moving pill.
			layoutScroll
			role='group'
			aria-label={ariaLabel}
			className={cn(
				'flex shrink-0 gap-0 rounded-full border-[0.5px] border-white/6 bg-white/3',
				size === 'sm' && 'h-[24px] p-1 text-9',
				size === 'default' && 'h-[30px] p-1 text-12',
				size === 'lg' && 'h-[40px] p-[5px] text-12',
				className,
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
					type='button'
					aria-pressed={value === tab.id}
					className={cn(
						'group relative flex-grow rounded-full leading-inter-trimmed outline-hidden transition-[box-shadow,background]',
						value === tab.id && variant === 'primary' && 'focus-visible:ring-2 focus-visible:ring-brand/40',
						value === tab.id && variant === 'muted-primary' && 'focus-visible:ring-2 focus-visible:ring-white/25',
						value !== tab.id && 'outline-1 -outline-offset-2 outline-transparent focus-visible:outline-white/10',
						size === 'sm' && 'px-2',
						size === 'default' && 'px-2.5',
						size === 'lg' && 'px-[14px]',
						tabClassName,
					)}
					disabled={!justTwo ? value === tab.id : undefined}
					onClick={() => onValueChange(tab.id)}
				>
					{value === tab.id && (
						<motion.span
							layoutId={id}
							className={cn(
								'absolute inset-0 z-10 rounded-full',
								variant === 'default' &&
									'bg-white/10 contrast-more:bg-white/30 contrast-more:ring-1 contrast-more:ring-white contrast-more:ring-inset',
								variant === 'primary' && 'bg-brand',
								variant === 'muted-primary' &&
									'bg-brand/45 shadow-button-highlight-soft-hpx contrast-more:bg-brand/70 contrast-more:ring-1 contrast-more:ring-white contrast-more:ring-inset',
							)}
							transition={
								variant === 'muted-primary'
									? {type: 'tween', ease: 'easeInOut', duration: 0.2}
									: {type: 'spring', bounce: 0.2, duration: 0.4}
							}
						/>
					)}
					<span
						className={cn(
							'relative z-10 transition-opacity duration-200',
							size === 'lg' && 'font-medium',
							value !== tab.id &&
								variant !== 'muted-primary' &&
								'opacity-50 group-hover:opacity-80 contrast-more:opacity-85 contrast-more:group-hover:opacity-100',
							value !== tab.id &&
								variant === 'muted-primary' &&
								'opacity-75 group-hover:opacity-90 contrast-more:opacity-90',
						)}
					>
						{tab.label}
					</span>
				</button>
			))}
		</motion.div>
	)
}
