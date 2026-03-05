import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as React from 'react'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {ScrollArea} from '@/components/ui/scroll-area'
import {cn} from '@/lib/utils'

import {
	dialogContentAnimationClass,
	dialogContentAnimationSlideClass,
	dialogContentClass,
	dialogFooterClass,
	dialogOverlayClass,
} from './shared/dialog'

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = (props: DialogPrimitive.DialogPortalProps) => <DialogPrimitive.Portal {...props} />
DialogPortal.displayName = DialogPrimitive.Portal.displayName

function DialogOverlay({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
	ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Overlay>>
}) {
	return <DialogPrimitive.Overlay ref={ref} className={cn(dialogOverlayClass, className)} {...props} />
}

function DialogContent({
	className,
	children,
	slide = true,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {slide?: boolean} & {
	ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Content>>
}) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				ref={ref}
				className={cn(
					dialogContentClass,
					dialogContentAnimationClass,
					slide && dialogContentAnimationSlideClass,
					'w-full max-w-[calc(100%-40px)] sm:max-w-[480px]',
					className,
				)}
				{...props}
			>
				{children}
				{/* <DialogPrimitive.Close className="absolute right-4 top-4 rounded-xs opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-500 dark:ring-offset-neutral-950 dark:focus:ring-neutral-300 dark:data-[state=open]:bg-neutral-800 dark:data-[state=open]:text-neutral-400">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close> */}
			</DialogPrimitive.Content>
		</DialogPortal>
	)
}

const DialogScrollableContent = ({
	children,
	showClose,
	onOpenAutoFocus,
}: {
	children: React.ReactNode
	showClose?: boolean
	onOpenAutoFocus?: (e: Event) => void
}) => {
	return (
		<DialogContent className='flex flex-col p-0' onOpenAutoFocus={onOpenAutoFocus}>
			{/* TODO: adjust dialog inset if `showClose` is true so close button isn't too close to scrollbar */}
			<ScrollArea className='flex flex-col' dialogInset>
				{children}
			</ScrollArea>
			{showClose && <DialogCloseButton className='absolute top-2 right-2 z-50' />}
		</DialogContent>
	)
}

const DialogHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('flex flex-col space-y-1.5', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn(dialogFooterClass, className)} {...props} />
)
DialogFooter.displayName = 'DialogFooter'

function DialogTitle({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & {
	ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Title>>
}) {
	return (
		<DialogPrimitive.Title
			ref={ref}
			className={cn('text-left text-17 leading-snug font-semibold -tracking-2', className)}
			{...props}
		/>
	)
}

function DialogDescription({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & {
	ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Description>>
}) {
	return (
		<DialogPrimitive.Description
			ref={ref}
			className={cn('text-left text-13 leading-tight font-normal -tracking-2 text-white/40', className)}
			{...props}
		/>
	)
}

export {
	Dialog,
	DialogContent,
	DialogScrollableContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
}
