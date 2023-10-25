import {type VariantProps} from 'class-variance-authority'
import type {LucideIcon} from 'lucide-react'
import * as React from 'react'
import {AnchorHTMLAttributes, ForwardRefExoticComponent, ReactNode, RefAttributes} from 'react'
import type {IconType} from 'react-icons'
import {Link, LinkProps} from 'react-router-dom'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

import {Icon} from './icon'

type CustomProps = VariantProps<typeof buttonVariants> & {
	icon: IconType | LucideIcon
}

// Stolen from `next/link` node_modules/next/dist/client/link.d.ts and modified to add custom props
type LinkType = ForwardRefExoticComponent<
	Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> &
		LinkProps & {
			children?: ReactNode
		} & RefAttributes<HTMLAnchorElement> &
		CustomProps
>

const IconLinkButton: LinkType = React.forwardRef(({className, variant, text, size, icon, children, ...props}, ref) => {
	return (
		<Link className={cn(buttonVariants({variant, size, text, className}))} ref={ref} {...props}>
			<Icon component={icon} size={size} />
			{children}
		</Link>
	)
})
IconLinkButton.displayName = 'IconLinkButton'

export {IconLinkButton}
