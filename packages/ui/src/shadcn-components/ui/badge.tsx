import {cva, type VariantProps} from 'class-variance-authority'
import {LucideIcon} from 'lucide-react'
import * as React from 'react'
import {IconType} from 'react-icons'

import {cn} from '@/shadcn-lib/utils'

const badgeVariants = cva(
	'inline-flex items-center rounded-full border px-2 py-1.5 text-12 font-normal transition-colors leading-inter-trimmed',
	{
		variants: {
			variant: {
				default: 'border-white/10 text-white/90 bg-white/10',
				primary: 'border-transparent text-white/90 bg-brand/70',
				destructive: 'border-transparent text-white/90 bg-destructive/30',
				outline: 'text-white/90 border-white/10',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
	icon?: IconType | LucideIcon
}

function Badge({className, variant, icon, children, ...props}: BadgeProps) {
	const Icon = icon
	return (
		<div className={cn(badgeVariants({variant}), className)} {...props}>
			{Icon && <Icon className='-ml-1 mr-0.5' />}
			{children}
		</div>
	)
}

export {Badge, badgeVariants}
