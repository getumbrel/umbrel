import * as AlertDialogPrimitive from '@radix-ui/react-dialog'
import {LucideIcon} from 'lucide-react'
import * as React from 'react'
import {IconType} from 'react-icons'
import {omit} from 'remeda'

import {Button, buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

import {
	dialogContentAnimationClass,
	dialogContentAnimationSlideClass,
	dialogContentClass,
	dialogFooterClass,
	dialogOverlayClass,
} from './shared/dialog'

// https://github.com/radix-ui/primitives/issues/1281#issuecomment-1081767007
const AlertDialogContext = React.createContext<{
	open?: boolean
	onOpenChange?: (open: boolean) => void
}>({
	open: false,
	onOpenChange: () => {},
})

function useDialogState() {
	const context = React.useContext(AlertDialogContext)
	if (!context) {
		throw new Error('useDialogState must be used within a AlertDialogProvider')
	}
	return context
}

const AlertDialog = ({children, ...props}: AlertDialogPrimitive.DialogProps) => {
	return (
		<AlertDialogContext.Provider
			value={{
				open: props.open,
				onOpenChange: props.onOpenChange,
			}}
		>
			<AlertDialogPrimitive.Root {...props}>{children}</AlertDialogPrimitive.Root>
		</AlertDialogContext.Provider>
	)
}

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = ({className, ...props}: AlertDialogPrimitive.DialogPortalProps) => (
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
			className={cn(
				dialogContentClass,
				dialogContentAnimationClass,
				dialogContentAnimationSlideClass,
				'w-full max-w-[calc(100%-40px)] sm:max-w-md',
				className,
			)}
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
	<div className={cn(dialogFooterClass, 'md:justify-center', className)} {...props} />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

const AlertDialogTitle = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Title
		ref={ref}
		className={cn(
			'whitespace-pre-line break-words text-center text-17 font-semibold leading-snug -tracking-2',
			className,
		)}
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
		className={cn(
			'whitespace-pre-line break-words text-13 font-normal leading-tight -tracking-2 text-white/60',
			className,
		)}
		{...props}
	/>
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
	React.ElementRef<typeof Button>,
	React.ComponentPropsWithoutRef<typeof Button> & {hideEnterIcon?: boolean}
>(({variant, hideEnterIcon, children, ...props}, ref) => (
	<Button ref={ref} size={'dialog'} variant={variant ?? 'primary'} {...props}>
		{children}
		{!hideEnterIcon && <span className='text-11 opacity-40 max-md:hidden'>↵</span>}
	</Button>
))
AlertDialogAction.displayName = 'AlertDialogAction'

const AlertDialogCancel = React.forwardRef<
	React.ElementRef<typeof Button>,
	React.ComponentPropsWithoutRef<typeof Button>
>(({className, ...props}, ref) => {
	const {onOpenChange} = useDialogState()
	return (
		<Button
			ref={ref}
			className={cn(buttonVariants({size: 'dialog'}), className)}
			onClick={(e) => {
				props.onClick?.(e)
				onOpenChange?.(false)
			}}
			{...props}
		/>
	)
})
AlertDialogCancel.displayName = 'AlertDialogCancel'

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
