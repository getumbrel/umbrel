import * as SheetPrimitive from '@radix-ui/react-dialog'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {cn} from '@/lib/utils'
import {useWallpaper, WallpaperAvifSource} from '@/providers/wallpaper'

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetPortal = (props: SheetPrimitive.DialogPortalProps) => <SheetPrimitive.Portal {...props} />
SheetPortal.displayName = SheetPrimitive.Portal.displayName

// The bottom-zoom side animates via the bespoke umbrel-sheet-zoom rules in
// index.css rather than these tw-animate utilities: tw-animate's shared
// enter/exit keyframes also animate `filter`, which is costly on a layer this
// large (see the rules for details)
const slideSheetAnimation =
	'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-100 data-[state=open]:duration-100 data-[state=closed]:fade-out data-[state=closed]:ease-in fill-mode-both'

const sheetVariants = cva('fixed z-30 gap-4 contrast-more:bg-black overflow-hidden outline-hidden', {
	variants: {
		side: {
			top: `inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top ${slideSheetAnimation}`,
			bottom: `inset-x-0 bottom-0 data-[state=closed]:slide-out-to-bottom-1/2 data-[state=open]:slide-in-from-bottom-1/2 ${slideSheetAnimation}`,
			'bottom-zoom': 'inset-x-0 bottom-0 umbrel-sheet-zoom',
			left: `inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm ${slideSheetAnimation}`,
			right: `inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm ${slideSheetAnimation}`,
		},
	},
	defaultVariants: {
		side: 'bottom',
	},
})

interface SheetContentProps
	extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {
	backdrop?: React.ReactNode
	closeButton?: React.ReactNode
	ref?: React.Ref<React.ComponentRef<typeof SheetPrimitive.Content>>
}

function SheetContent({
	side = 'bottom',
	className,
	children,
	backdrop,
	closeButton = <DialogCloseButton surface='sheet' />,
	ref,
	...props
}: SheetContentProps) {
	const {wallpaper} = useWallpaper()

	return (
		// <SheetPortal container={document.getElementById("container")}>
		<>
			{backdrop}
			{/* <SheetOverlay /> */}
			<SheetPrimitive.Content
				ref={ref}
				className={cn(
					sheetVariants({side}),
					// will-change alone keeps the layer promoted; a static transform here
					// would force the zoom keyframes through matrix interpolation
					'umbrel-window-shadow umbrel-window-surface-top will-change-[transform]',
					className,
				)}
				{...props}
			>
				{/* Keep before other elements to prevent auto-focus on other elements. Some element must be focused for accessibility */}
				{closeButton}
				{/* Clips the wallpaper (a composited, scaled layer) to the rounded corners
				    itself: Safari does not reliably clip a composited child by an ancestor's
				    radius while that ancestor animates, and the transform keeps this layer
				    composited so the clip applies to the child */}
				<div className='umbrel-window-surface-top absolute inset-0 transform-gpu overflow-hidden bg-black contrast-more:hidden'>
					{/* Fade in the wallpaper to avoid a flash when the sheet opens. The
					    tint layer above stays constant so the fade happens under it. */}
					{/* An empty src resolves to the current document, so fall back to the
					    plain black underneath until a wallpaper is actually resolved */}
					{wallpaper.url && (
						<picture>
							<WallpaperAvifSource wallpaper={wallpaper} tier='thumbnails' />
							<img
								src={wallpaper.url}
								alt=''
								aria-hidden='true'
								className='umbrel-window-wallpaper absolute inset-0 size-full object-cover object-center opacity-0'
							/>
						</picture>
					)}
					<div className='umbrel-window-tint absolute inset-0' />
				</div>
				{children}
				{/* Window edge and inner shine */}
				<div className='umbrel-window-chrome umbrel-window-surface-top pointer-events-none absolute inset-0 z-50' />
			</SheetPrimitive.Content>
		</>
		// </SheetPortal>
	)
}

const SheetHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('flex flex-col gap-2', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

const SheetFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
)
SheetFooter.displayName = 'SheetFooter'

function SheetTitle({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title> & {
	ref?: React.Ref<React.ComponentRef<typeof SheetPrimitive.Title>>
}) {
	return (
		<SheetPrimitive.Title
			ref={ref}
			className={cn('text-24 font-bold -tracking-3 text-white/75 md:text-48 low:text-24', className)}
			{...props}
		/>
	)
}

function SheetDescription({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description> & {
	ref?: React.Ref<React.ComponentRef<typeof SheetPrimitive.Description>>
}) {
	return <SheetPrimitive.Description ref={ref} className={cn('text-sm text-neutral-400', className)} {...props} />
}

export {Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger}
