import {type VariantProps} from 'class-variance-authority'
import * as React from 'react'
import {AnchorHTMLAttributes, ForwardRefExoticComponent, ReactNode, RefAttributes} from 'react'
import {Link, LinkProps} from 'react-router-dom'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

type CustomProps = VariantProps<typeof buttonVariants>

// Stolen from `next/link` node_modules/next/dist/client/link.d.ts and modified to add custom props
type LinkType = ForwardRefExoticComponent<
	Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> &
		LinkProps & {
			children?: ReactNode
		} & RefAttributes<HTMLAnchorElement> &
		CustomProps
>

const ButtonLink: LinkType = React.forwardRef(({className, variant, text, size, ...props}, ref) => {
	return <Link className={cn(buttonVariants({variant, size, text, className}))} ref={ref} {...props} />
})
ButtonLink.displayName = 'ButtonLink'

export {ButtonLink}
