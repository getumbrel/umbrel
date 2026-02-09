import * as SheetPrimitive from '@radix-ui/react-dialog'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'

import {cn} from '@/lib/utils'
import {useWallpaper} from '@/providers/wallpaper'

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetPortal = (props: SheetPrimitive.DialogPortalProps) => <SheetPrimitive.Portal {...props} />
SheetPortal.displayName = SheetPrimitive.Portal.displayName

const sheetVariants = cva(
	'fixed z-30 gap-4 bg-black/70 contrast-more:bg-black overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-100 data-[state=open]:duration-100 outline-hidden data-[state=closed]:fade-out data-[state=closed]:ease-in fill-mode-both',
	{
		variants: {
			side: {
				top: 'inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
				bottom:
					'inset-x-0 bottom-0 data-[state=closed]:slide-out-to-bottom-1/2 data-[state=open]:slide-in-from-bottom-1/2 rounded-t-20',
				'bottom-zoom':
					'inset-x-0 bottom-0 data-[state=closed]:zoom-out-75 data-[state=open]:zoom-in-90 rounded-t-20 data-[state=open]:duration-200 data-[state=closed]:duration-100',
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
	closeButton = true,
	ref,
	...props
}: SheetContentProps) {
	const {wallpaper} = useWallpaper()

	return (
		// <SheetPortal container={document.getElementById("container")}>
		<>
			{backdrop}
			{/* <SheetOverlay /> */}
			<SheetPrimitive.Content ref={ref} className={cn(sheetVariants({side}), className)} {...props}>
				{/* Keep before other elements to prevent auto-focus on other elements. Some element must be focused for accessibility */}
				{closeButton}
				<div className='absolute inset-0 bg-black contrast-more:hidden'>
					{/* Fade in sheet background to avoid white flash when sheet opens */}
					<div
						className='absolute inset-0 opacity-0'
						style={{
							animation: 'fade-in 700ms ease-out 200ms both',
							backgroundImage: `url(/assets/wallpapers/generated-thumbs/${wallpaper.id}.jpg)`,
							backgroundSize: 'cover',
							backgroundPosition: 'center',
							transform: 'scale(1.2) rotate(180deg)',
						}}
					/>
					<div className='absolute inset-0 backdrop-blur-3xl backdrop-brightness-[0.3] backdrop-saturate-[1.2]' />
				</div>
				{children}
				{/* Sheet inner glow highlight */}
				<div className='pointer-events-none absolute inset-0 z-50 rounded-t-20 shadow-sheet-shadow' />
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
			className={cn('text-24 font-bold -tracking-3 text-white/75 md:text-48', className)}
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
