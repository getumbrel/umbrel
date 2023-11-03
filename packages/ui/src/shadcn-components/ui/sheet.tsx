import * as SheetPrimitive from '@radix-ui/react-dialog'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'

import {cn} from '@/shadcn-lib/utils'

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = ({className, ...props}: SheetPrimitive.DialogPortalProps) => (
	<SheetPrimitive.Portal className={cn(className)} {...props} />
)
SheetPortal.displayName = SheetPrimitive.Portal.displayName

const SheetOverlay = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({className, ...props}, ref) => (
	<SheetPrimitive.Overlay
		className={cn(
			'bg-background/80 fixed inset-0 z-30 backdrop-blur-xl duration-700 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
			className,
		)}
		{...props}
		ref={ref}
	/>
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
	'fixed z-30 gap-4 px-10 bg-black/70 contrast-more:bg-black overflow-hidden shadow-lg transition-[opacity,transform] ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-100 data-[state=open]:duration-200 backdrop-blur-4xl contrast-more:backdrop-blur-none sheet-shadow outline-none data-[state=closed]:fade-out data-[state=closed]:ease-in',
	{
		variants: {
			side: {
				top: 'inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
				bottom:
					'inset-x-0 bottom-0 data-[state=closed]:slide-out-to-bottom-1/2 data-[state=open]:slide-in-from-bottom-1/2 rounded-t-20',
				left: 'inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
				right:
					'inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
			},
		},
		defaultVariants: {
			side: 'bottom',
		},
	},
)

interface SheetContentProps
	extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
		VariantProps<typeof sheetVariants> {
	backdrop?: React.ReactNode
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
	({side = 'bottom', className, children, backdrop, ...props}, ref) => (
		// <SheetPortal container={document.getElementById("container")}>
		<>
			{backdrop}
			{/* <SheetOverlay /> */}
			<SheetPrimitive.Content ref={ref} className={cn(sheetVariants({side}), className)} {...props}>
				{children}
				<SheetPrimitive.Close className='absolute right-2.5 top-2.5 z-50 rounded-full opacity-30 outline-none ring-white/60 transition-opacity hover:opacity-40 focus-visible:opacity-40 focus-visible:ring-2'>
					<RiCloseCircleFill className='h-6 w-6' />
					<span className='sr-only'>Close</span>
				</SheetPrimitive.Close>
			</SheetPrimitive.Content>
		</>
		// </SheetPortal>
	),
)
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

const SheetFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
)
SheetFooter.displayName = 'SheetFooter'

const SheetTitle = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({className, ...props}, ref) => (
	<SheetPrimitive.Title ref={ref} className={cn('text-32 font-bold -tracking-3 text-white/75', className)} {...props} />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({className, ...props}, ref) => (
	<SheetPrimitive.Description ref={ref} className={cn('text-sm text-neutral-400', className)} {...props} />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger}
