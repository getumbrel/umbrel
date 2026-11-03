import {Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTrigger} from '@radix-ui/react-dialog'
import {motion} from 'motion/react'
import {Children, ComponentPropsWithoutRef, ReactNode, useEffect} from 'react'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {ScrollArea} from '@/components/ui/scroll-area'
import {
	dialogContentAnimationClass,
	dialogContentAnimationSlideClass,
	dialogContentClass,
	dialogOverlayClass,
	preventDialogDismissForToasts,
} from '@/components/ui/shared/dialog'
import {cn} from '@/lib/utils'
import {useImmersiveDialogCounter} from '@/providers/immersive-dialog'
import {tw} from '@/utils/tw'

import {IconTypes} from './icon'

// Phones are narrow enough for a title to reach the close button
export const immersiveDialogTitleClass = tw`text-24 font-bold leading-none -tracking-4 text-white/80 pe-4`
export const immersiveDialogDescriptionClass = tw`text-15 font-normal leading-tight -tracking-2 text-white/40`

export function ImmersiveDialogSeparator() {
	return <hr className='w-full border-white/10' />
}

// Wrapper that tracks open state in context so other components (like floating islands) can react.
// For example, when an immersive dialog is open, the floating islands z-index is raised to show above it.
export function ImmersiveDialog({open, children, ...props}: ComponentPropsWithoutRef<typeof Dialog>) {
	const {increment, decrement} = useImmersiveDialogCounter()

	// Increment counter on open, decrement on close/unmount.
	// Counter approach is more robust than boolean for complex dialogs (see provider comments).
	useEffect(() => {
		if (open) {
			increment()
			return () => decrement()
		}
	}, [open, increment, decrement])

	return (
		<Dialog open={open} {...props}>
			{children}
		</Dialog>
	)
}
export const ImmersiveDialogTrigger = DialogTrigger

export function ImmersiveDialogContent({
	children,
	size = 'default',
	short = false,
	showScroll = false,
	ref,
	className,
	...contentProps
}: {
	children: React.ReactNode
	size?: 'default' | 'sm' | 'md' | 'lg' | 'xl'
	short?: boolean
	showScroll?: boolean
	ref?: React.Ref<HTMLDivElement>
} & Omit<ComponentPropsWithoutRef<typeof DialogContent>, 'asChild'>) {
	return (
		<DialogContent
			ref={ref}
			className={cn(
				dialogContentClass,
				'umbrel-window-surface-all',
				dialogContentAnimationClass,
				dialogContentAnimationSlideClass,
				short ? immersiveContentShortClass : immersiveContentTallClass,
				// overrides default size
				size === 'sm' && 'max-w-[600px]',
				size === 'md' && 'max-w-[900px]',
				size === 'lg' && 'max-w-[980px]',
				size === 'xl' && 'max-w-[1440px]',
				'p-0',
				className,
			)}
			{...contentProps}
			// Compose after the spread so a caller's handler adds to the toast guard
			onPointerDownOutside={(event) => {
				preventDialogDismissForToasts(event)
				contentProps.onPointerDownOutside?.(event)
			}}
		>
			{showScroll ? (
				<ScrollArea
					dialogInset
					className={cn(
						'h-full',
						// Short dialogs have no fixed height, so the viewport must inherit the
						// height cap too; otherwise it grows beyond the dialog and gets clipped.
						short && 'max-h-[inherit] [&>[data-radix-scroll-area-viewport]]:max-h-[inherit]',
					)}
				>
					<div className={immersiveScrollAreaContentsClass}>{children}</div>
				</ScrollArea>
			) : (
				<div className={immersiveScrollAreaContentsClass}>{children}</div>
			)}
			<div className='umbrel-window-chrome umbrel-window-surface-all pointer-events-none absolute inset-0 z-50' />
			<DialogCloseButton surface='immersive' />
		</DialogContent>
	)
}

export function ImmersiveDialogSplitContent({
	children,
	side,
	footer,
	ref,
	...contentProps
}: {
	children: React.ReactNode
	side: React.ReactNode
	// Rendered below the scroll area so it stays visible however long the content is
	footer?: React.ReactNode
	ref?: React.Ref<HTMLDivElement>
} & Omit<ComponentPropsWithoutRef<typeof DialogContent>, 'asChild'>) {
	return (
		<DialogPortal>
			<ImmersiveDialogOverlay />
			<DialogContent
				ref={ref}
				className={cn(
					dialogContentClass,
					'umbrel-window-surface-all',
					'bg-transparent shadow-none ring-2 ring-white/3', // remove shadow from `dialogContentClass`
					dialogContentAnimationClass,
					dialogContentAnimationSlideClass,
					immersiveContentTallClass,
					'flex flex-row justify-between gap-0 p-0',
				)}
				{...contentProps}
				// Compose after the spread so a caller's handler adds to the toast guard
				onPointerDownOutside={(event) => {
					preventDialogDismissForToasts(event)
					contentProps.onPointerDownOutside?.(event)
				}}
			>
				<section className='hidden w-[210px] flex-col items-center justify-center bg-black/40 md:flex md:[border-top-left-radius:var(--window-radius)] md:[border-bottom-left-radius:var(--window-radius)]'>
					{side}
				</section>
				<section className='umbrel-window-tint flex min-w-0 flex-1 flex-col overflow-hidden max-md:[border-radius:var(--window-radius)] md:[border-top-right-radius:var(--window-radius)] md:[border-bottom-right-radius:var(--window-radius)]'>
					<ScrollArea dialogInset className='min-h-0 flex-1'>
						<div className={immersiveScrollAreaContentsClass}>{children}</div>
					</ScrollArea>
					{footer}
				</section>
				<div className='umbrel-window-chrome umbrel-window-surface-all pointer-events-none absolute inset-0 z-50' />
				<DialogCloseButton surface='immersive' />
			</DialogContent>
		</DialogPortal>
	)
}

const immersiveContentShortClass = tw`w-[calc(100%-40px)] max-w-[800px] max-h-[calc(100dvh-40px)]`
const immersiveContentTallClass = tw`max-h-[800px] w-[calc(100%-40px)] max-w-[800px] h-[calc(100dvh-40px)]`
const immersiveScrollAreaContentsClass = tw`flex h-full flex-col gap-6 px-6 py-4 md:p-8`

export function ImmersiveDialogOverlay({ref}: {ref?: React.Ref<HTMLDivElement>}) {
	return (
		<DialogOverlay
			ref={ref}
			className={cn(dialogOverlayClass, 'transform-gpu bg-black/30 backdrop-blur-xl contrast-more:backdrop-blur-none')}
		/>
	)
}

export function ImmersiveDialogBody({
	title,
	description,
	bodyText,
	children,
	footer,
}: {
	title: string
	description: string
	bodyText: React.ReactNode
	children: React.ReactNode
	footer: React.ReactNode
}) {
	return (
		<div className='flex h-full flex-col items-start gap-5'>
			<div className='space-y-2'>
				<h1 className={immersiveDialogTitleClass}>{title}</h1>
				<p className={immersiveDialogDescriptionClass}>{description}</p>
			</div>
			<ImmersiveDialogSeparator />
			<div className='w-full space-y-2.5'>
				<div className={cn('mb-4', bodyTextClass)}>{bodyText}</div>
				<AnimateIn>{children}</AnimateIn>
			</div>
			<div className='flex-1' />
			<ImmersiveDialogFooter>{footer}</ImmersiveDialogFooter>
		</div>
	)
}

const bodyTextClass = tw`text-15 font-medium leading-none -tracking-4 text-white/90`

function AnimateIn({children}: {children: React.ReactNode}) {
	return (
		<>
			{Children.map(children, (child, i) => (
				<motion.div
					// TODO: don't use index as key
					key={i}
					initial={{opacity: 0, translateY: 10}}
					animate={{opacity: 1, translateY: 0}}
					transition={{delay: i * 0.2 + 0.1}}
				>
					{child}
				</motion.div>
			))}
		</>
	)
}

export function ImmersiveDialogFooter({children, className}: {children: React.ReactNode; className?: string}) {
	return <div className={cn('flex w-full flex-wrap-reverse items-center gap-2', className)}>{children}</div>
}

export function ImmersiveDialogIconMessage({
	icon,
	title,
	description,
	className,
	iconClassName,
}: {
	icon: IconTypes
	title: ReactNode
	description?: ReactNode
	className?: string
	iconClassName?: string
}) {
	const IconComponent = icon

	return (
		<div
			className={cn(
				'inline-flex w-full items-center gap-2 rounded-10 border border-white/4 bg-white/4 p-2 text-left font-normal',
				className,
			)}
			style={{
				boxShadow: '0px 40px 60px 0px rgba(0, 0, 0, 0.10)',
			}}
		>
			<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-8 bg-white/4'>
				<IconComponent className={cn('h-5 w-5 [&>*]:stroke-1', iconClassName)} />
			</div>
			<div className='space-y-1'>
				<div className='text-13 leading-tight font-normal -tracking-2'>{title}</div>
				{description && (
					<div className='text-12 leading-tight font-normal -tracking-2 text-white/50'>{description}</div>
				)}
			</div>
		</div>
	)
}

export function ImmersiveDialogIconMessageKeyValue({
	icon,
	k,
	v,
	className,
	iconClassName,
}: {
	icon: IconTypes
	k: ReactNode
	v: ReactNode
	className?: string
	iconClassName?: string
}) {
	const IconComponent = icon

	return (
		<div
			className={cn(
				'inline-flex w-full items-center gap-2 rounded-10 border border-white/4 bg-white/4 px-3 py-2.5 text-left font-normal',
				className,
			)}
			style={{
				boxShadow: '0px 40px 60px 0px rgba(0, 0, 0, 0.10)',
			}}
		>
			<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-8 bg-white/4'>
				<IconComponent className={cn('h-5 w-5', iconClassName)} />
			</div>
			<div className='flex flex-1 text-14'>
				<div className='flex-1 leading-tight font-normal -tracking-2 opacity-60'>{k}</div>
				<div className='leading-tight font-medium -tracking-2'>{v}</div>
			</div>
		</div>
	)
}
