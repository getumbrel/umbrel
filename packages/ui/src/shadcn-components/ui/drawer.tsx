import * as React from 'react'
import {Drawer as DrawerPrimitive} from 'vaul'

import {cn} from '@/shadcn-lib/utils'

const Drawer = ({shouldScaleBackground = false, ...props}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
	<DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
)
Drawer.displayName = 'Drawer'

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({className, ...props}, ref) => (
	<DrawerPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/50', className)} {...props} />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

const DrawerContent = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & {fullHeight?: boolean}
>(({className, children, fullHeight, ...props}, ref) => (
	<DrawerPortal>
		<DrawerOverlay />
		<DrawerPrimitive.Content
			ref={ref}
			className={cn(
				'fixed inset-x-0 bottom-0 z-50 mt-24 flex flex h-auto flex-col flex-col gap-5 rounded-t-20 bg-[#0F0F0F] p-5 outline-none',
				fullHeight && 'top-0',
				className,
			)}
			style={{
				boxShadow: '0px 2px 2px 0px hsla(0, 0%, 100%, 0.05) inset',
			}}
			{...props}
		>
			{/* -mb-[4px] so height is effectively zero */}
			<div className='top-6 mx-auto -mb-[4px] h-[4px] w-[40px] shrink-0 rounded-full bg-white/10' />
			{children}
		</DrawerPrimitive.Content>
	</DrawerPortal>
))
DrawerContent.displayName = 'DrawerContent'

const DrawerHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('grid gap-0.5', className)} {...props} />
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('mt-auto flex shrink-0 flex-col gap-2.5', className)} {...props} />
)
DrawerFooter.displayName = 'DrawerFooter'

const DrawerTitle = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({className, ...props}, ref) => (
	<DrawerPrimitive.Title ref={ref} className={cn('text-19 font-bold leading-tight', className)} {...props} />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({className, ...props}, ref) => (
	<DrawerPrimitive.Description
		ref={ref}
		className={cn('text-12 leading-tight -tracking-2 opacity-50', className)}
		{...props}
	/>
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
	Drawer,
	DrawerPortal,
	DrawerOverlay,
	DrawerTrigger,
	DrawerClose,
	DrawerContent,
	DrawerHeader,
	DrawerFooter,
	DrawerTitle,
	DrawerDescription,
}
