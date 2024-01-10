import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import {LucideIcon} from 'lucide-react'
import * as React from 'react'
import {IconType} from 'react-icons'
import {omit} from 'remeda'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

import {dialogContentClass, dialogOverlayClass} from './shared/dialog'

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = ({className, ...props}: AlertDialogPrimitive.AlertDialogPortalProps) => (
	<AlertDialogPrimitive.Portal className={cn(className)} {...props} />
)
AlertDialogPortal.displayName = AlertDialogPrimitive.Portal.displayName

const AlertDialogOverlay = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Overlay
		className={cn(dialogOverlayClass, className)}
		{...omit(props, ['children'])}
		ref={ref}
	/>
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({className, ...props}, ref) => (
	<AlertDialogPortal>
		<AlertDialogOverlay />
		<AlertDialogPrimitive.Content
			ref={ref}
			className={cn(dialogContentClass, 'w-full max-w-[calc(100%-40px)] sm:w-auto md:max-w-md', className)}
			{...props}
		/>
	</AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
	className,
	icon,
	children,
	...props
}: React.HTMLAttributes<HTMLDivElement> & {
	icon?: IconType | LucideIcon
}) => {
	const IconComponent = icon
	return (
		<div className={cn('flex flex-col space-y-2 text-center', className)} {...props}>
			{IconComponent && <IconComponent className='mx-auto h-7 w-7 rounded-full bg-white/10 p-1' />}
			{children}
		</div>
	)
}
AlertDialogHeader.displayName = 'AlertDialogHeader'

const AlertDialogFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-center', className)} {...props} />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

const AlertDialogTitle = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Title
		ref={ref}
		className={cn('text-center text-17 font-semibold -tracking-2', className)}
		{...props}
	/>
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Description
		ref={ref}
		className={cn('text-13 font-normal leading-tight -tracking-2 text-white/40', className)}
		{...props}
	/>
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Action>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & {
		variant?: 'primary' | 'destructive'
	}
>(({className, variant, children, ...props}, ref) => (
	<AlertDialogPrimitive.Action
		ref={ref}
		className={cn(buttonVariants({size: 'dialog', variant: variant ?? 'primary'}), className)}
		{...props}
	>
		{children}
		<span className='text-11 opacity-40'>↵</span>
	</AlertDialogPrimitive.Action>
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Cancel ref={ref} className={cn(buttonVariants({size: 'dialog'}), className)} {...props} />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
	AlertDialog,
	AlertDialogTrigger,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogAction,
	AlertDialogCancel,
}
