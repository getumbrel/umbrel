import * as AlertDialogPrimitive from '@radix-ui/react-dialog'
import {LucideIcon} from 'lucide-react'
import * as React from 'react'
import {IconType} from 'react-icons'
import {omit} from 'remeda'

import {Button, buttonVariants} from '@/components/ui/button'
import {cn} from '@/lib/utils'

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
		<AlertDialogContext
			value={{
				open: props.open,
				onOpenChange: props.onOpenChange,
			}}
		>
			<AlertDialogPrimitive.Root {...props}>{children}</AlertDialogPrimitive.Root>
		</AlertDialogContext>
	)
}

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = (props: AlertDialogPrimitive.DialogPortalProps) => <AlertDialogPrimitive.Portal {...props} />
AlertDialogPortal.displayName = AlertDialogPrimitive.Portal.displayName

function AlertDialogOverlay({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay> & {
	ref?: React.Ref<React.ComponentRef<typeof AlertDialogPrimitive.Overlay>>
}) {
	return (
		<AlertDialogPrimitive.Overlay
			className={cn(dialogOverlayClass, className)}
			{...omit(props, ['children'])}
			ref={ref}
		/>
	)
}

function AlertDialogContent({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
	ref?: React.Ref<React.ComponentRef<typeof AlertDialogPrimitive.Content>>
}) {
	return (
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
	)
}

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

function AlertDialogTitle({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title> & {
	ref?: React.Ref<React.ComponentRef<typeof AlertDialogPrimitive.Title>>
}) {
	return (
		<AlertDialogPrimitive.Title
			ref={ref}
			className={cn(
				'text-center text-17 leading-snug font-semibold -tracking-2 break-words whitespace-pre-line',
				className,
			)}
			{...props}
		/>
	)
}

function AlertDialogDescription({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description> & {
	ref?: React.Ref<React.ComponentRef<typeof AlertDialogPrimitive.Description>>
}) {
	return (
		<AlertDialogPrimitive.Description
			ref={ref}
			className={cn(
				'text-13 leading-tight font-normal -tracking-2 break-words whitespace-pre-line text-white/60',
				className,
			)}
			{...props}
		/>
	)
}

function AlertDialogAction({
	variant,
	hideEnterIcon,
	children,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof Button> & {hideEnterIcon?: boolean} & {
	ref?: React.Ref<React.ComponentRef<typeof Button>>
}) {
	return (
		<Button ref={ref} size={'dialog'} variant={variant ?? 'primary'} {...props}>
			{children}
			{!hideEnterIcon && <span className='text-11 opacity-40 max-md:hidden'>↵</span>}
		</Button>
	)
}

function AlertDialogCancel({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof Button> & {
	ref?: React.Ref<React.ComponentRef<typeof Button>>
}) {
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
}

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
