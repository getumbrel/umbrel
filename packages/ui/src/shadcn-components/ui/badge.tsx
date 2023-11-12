import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'

import {cn} from '@/shadcn-lib/utils'

const badgeVariants = cva(
	'inline-flex items-center rounded-full border px-2 py text-12 font-normal transition-colors',
	{
		variants: {
			variant: {
				default: 'border-transparent text-black/80 bg-white/70',
				primary: 'border-transparent text-white/90 bg-brand/70',
				secondary: 'border-transparent text-white/70 bg-white/10',
				destructive: 'border-transparent text-white/70 bg-destructive/50',
				outline: 'text-white/90 border-white/10',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({className, variant, ...props}: BadgeProps) {
	return <div className={cn(badgeVariants({variant}), className)} {...props} />
}

export {Badge, badgeVariants}
