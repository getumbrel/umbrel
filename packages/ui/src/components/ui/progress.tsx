import * as ProgressPrimitive from '@radix-ui/react-progress'
import {cva, VariantProps} from 'class-variance-authority'
import * as React from 'react'

import {cn} from '@/lib/utils'

const progressVariants = cva('relative w-full overflow-hidden rounded-full bg-white/10', {
	variants: {
		size: {
			default: 'h-1.5',
			thicker: 'h-2',
		},
	},
	defaultVariants: {
		size: 'default',
	},
})

const progressIndicatorVariants = cva('h-full w-full flex-1 bg-white transition-all duration-700 rounded-full', {
	variants: {
		variant: {
			default: 'bg-white',
			primary: 'bg-brand',
		},
	},
	defaultVariants: {
		variant: 'default',
	},
})

function Progress({
	className,
	value,
	variant,
	size,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> &
	VariantProps<typeof progressVariants> &
	VariantProps<typeof progressIndicatorVariants> & {
		ref?: React.Ref<React.ComponentRef<typeof ProgressPrimitive.Root>>
	}) {
	// The value reaches the root too, so the bar reports how far along it is
	// rather than reading as indeterminate. Anything that isn't a number in range
	// (some callers can pass NaN) is left indeterminate.
	const ariaValue = typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : null

	return (
		// `className` is the track's alone: on the indicator too, a margin would push the fill out of the track
		<ProgressPrimitive.Root ref={ref} className={cn(progressVariants({size}), className)} value={ariaValue} {...props}>
			<ProgressPrimitive.Indicator
				className={progressIndicatorVariants({variant})}
				style={{transform: `translateX(-${100 - (value || 0)}%)`}}
			/>
		</ProgressPrimitive.Root>
	)
}

export {Progress}
