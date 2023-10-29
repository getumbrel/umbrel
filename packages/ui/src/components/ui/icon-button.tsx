import {type VariantProps} from 'class-variance-authority'
import type {LucideIcon} from 'lucide-react'
import * as React from 'react'
import type {IconType} from 'react-icons'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

import {Icon} from './icon'

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	icon: IconType | LucideIcon
}

const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({className, variant, text, size, icon, children, ...props}, ref) => {
		// No children for icon-only buttons
		const children2 = size === 'icon-only' ? null : children

		return (
			<button className={cn(buttonVariants({variant, size, text, className}))} ref={ref} {...props}>
				<Icon component={icon} size={size} />
				{children2}
			</button>
		)
	},
)
IconButton.displayName = 'IconButton'

export {IconButton}
