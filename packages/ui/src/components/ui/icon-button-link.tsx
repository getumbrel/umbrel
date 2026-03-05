import {type VariantProps} from 'class-variance-authority'
import * as React from 'react'
import {AnchorHTMLAttributes, ReactNode} from 'react'
import {Link, LinkProps} from 'react-router-dom'

import {buttonVariants} from '@/components/ui/button'
import {cn} from '@/lib/utils'

import {Icon, IconTypes} from './icon'

type CustomProps = VariantProps<typeof buttonVariants> & {
	icon?: IconTypes
}

type IconButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> &
	LinkProps & {
		children?: ReactNode
	} & CustomProps & {
		ref?: React.Ref<HTMLAnchorElement>
	}

function IconButtonLink({className, variant, text, size, icon, children, ref, ...props}: IconButtonLinkProps) {
	return (
		<Link className={cn(buttonVariants({variant, size, text, className}))} ref={ref} {...props}>
			{icon && <Icon component={icon} size={size} />}
			{children}
		</Link>
	)
}

export {IconButtonLink}
