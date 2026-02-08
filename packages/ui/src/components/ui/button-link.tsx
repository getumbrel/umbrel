import {type VariantProps} from 'class-variance-authority'
import * as React from 'react'
import {AnchorHTMLAttributes, ReactNode} from 'react'
import {Link, LinkProps} from 'react-router-dom'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

type CustomProps = VariantProps<typeof buttonVariants>

type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> &
	LinkProps & {
		children?: ReactNode
	} & CustomProps & {
		ref?: React.Ref<HTMLAnchorElement>
	}

function ButtonLink({className, variant, text, size, ref, ...props}: ButtonLinkProps) {
	return <Link className={cn(buttonVariants({variant, size, text, className}))} ref={ref} {...props} />
}

export {ButtonLink}
