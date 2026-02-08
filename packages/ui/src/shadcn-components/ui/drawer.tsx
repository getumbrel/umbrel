import * as React from 'react'
import {Drawer as DrawerPrimitive} from 'vaul'

import {FadeScroller} from '@/components/fade-scroller'
import {cn} from '@/shadcn-lib/utils'

const Drawer = ({shouldScaleBackground = false, ...props}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
	<DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
)

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

function DrawerOverlay({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay> & {
	ref?: React.Ref<React.ComponentRef<typeof DrawerPrimitive.Overlay>>
}) {
	return <DrawerPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/50', className)} {...props} />
}

function DrawerContent({
	className,
	ref,
	children,
	fullHeight,
	withScroll,
	...props
}: React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & {
	fullHeight?: boolean
	withScroll?: boolean
	ref?: React.Ref<React.ComponentRef<typeof DrawerPrimitive.Content>>
}) {
	return (
		<DrawerPortal>
			<DrawerOverlay />
			<DrawerPrimitive.Content
				ref={ref}
				className={cn(
					'fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col gap-5 rounded-t-20 bg-[#0F0F0F] p-5 outline-hidden',
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
				{!withScroll && children}
				{withScroll && <DrawerScroller>{children}</DrawerScroller>}
			</DrawerPrimitive.Content>
		</DrawerPortal>
	)
}

const DrawerHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('grid gap-0.5', className)} {...props} />
)

const DrawerFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('mt-auto flex shrink-0 flex-col gap-2.5', className)} {...props} />
)

function DrawerTitle({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title> & {
	ref?: React.Ref<React.ComponentRef<typeof DrawerPrimitive.Title>>
}) {
	return <DrawerPrimitive.Title ref={ref} className={cn('text-19 leading-tight font-bold', className)} {...props} />
}

function DrawerDescription({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description> & {
	ref?: React.Ref<React.ComponentRef<typeof DrawerPrimitive.Description>>
}) {
	return (
		<DrawerPrimitive.Description
			ref={ref}
			className={cn('text-12 leading-tight -tracking-2 opacity-50', className)}
			{...props}
		/>
	)
}

// Put this in the content of a `Drawer` to make it scrollable. You might need to add `flex-1` to the parent.
function DrawerScroller({children}: {children: React.ReactNode}) {
	return (
		<FadeScroller direction='y' className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto'>
			{children}
		</FadeScroller>
	)
}

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
	DrawerScroller,
}
