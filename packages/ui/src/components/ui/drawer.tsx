import * as React from 'react'
import {Drawer as DrawerPrimitive} from 'vaul'

import {FadeScroller} from '@/components/fade-scroller'
import {preventDialogDismissForToasts} from '@/components/ui/shared/dialog'
import {cn} from '@/lib/utils'

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
	onPointerDownOutside,
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
					'umbrel-window-shadow umbrel-window-surface-top fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col gap-5 bg-[#0A0A0A] p-5 outline-hidden low:mt-3 low:max-h-[calc(100%-12px)]',
					fullHeight && 'top-0',
					className,
				)}
				{...props}
				// Compose after the spread so a caller's handler adds to the toast
				// guard instead of replacing it
				onPointerDownOutside={(event) => {
					preventDialogDismissForToasts(event)
					onPointerDownOutside?.(event)
				}}
			>
				{/* -mb-[4px] so height is effectively zero */}
				<div className='top-6 mx-auto -mb-[4px] h-[4px] w-[40px] shrink-0 rounded-full bg-white/10' />
				{!withScroll && children}
				{withScroll && <DrawerScroller>{children}</DrawerScroller>}
				{/* Window edge and inner shine */}
				<div className='umbrel-window-chrome umbrel-window-surface-top pointer-events-none absolute inset-0 z-50' />
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
function DrawerScroller({
	children,
	fade = true,
	ref,
}: {
	children: React.ReactNode
	fade?: boolean
	ref?: React.Ref<HTMLDivElement>
}) {
	const className = 'umbrel-stable-gutter flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto'
	if (!fade)
		return (
			<div ref={ref} className={className}>
				{children}
			</div>
		)

	return (
		<FadeScroller ref={ref} direction='y' className={className}>
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
