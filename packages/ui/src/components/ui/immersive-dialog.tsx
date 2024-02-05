import {Dialog, DialogClose, DialogContent, DialogOverlay, DialogPortal} from '@radix-ui/react-dialog'
import {motion} from 'framer-motion'
import {LucideIcon} from 'lucide-react'
import {Children, ForwardedRef, forwardRef, ReactNode} from 'react'
import type {IconType} from 'react-icons'
import {RiCloseLine} from 'react-icons/ri'

import {dialogContentClass, dialogOverlayClass} from '@/shadcn-components/ui/shared/dialog'
import {cn} from '@/shadcn-lib/utils'
import {afterDelayedClose} from '@/utils/dialog'
import {tw} from '@/utils/tw'

import {IconButton} from './icon-button'

export const immersiveDialogTitleClass = tw`text-24 font-bold leading-none -tracking-4 text-white/80`
export const immersiveDialogDescriptionClass = tw`text-15 font-normal leading-tight -tracking-2 text-white/40`

export function ImmersiveDialogSeparator() {
	return <hr className='w-full border-white/10' />
}

export function ImmersiveDialog({
	children,
	open,
	onOpenChange,
}: {
	children: React.ReactNode
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				{/* shell */}
				<DialogContent className={cn(dialogContentClass, immersiveContentSizeClass, 'p-0')}>
					<div className='umbrel-dialog-fade-scroller flex h-full flex-col gap-6 overflow-y-auto p-6 md:p-[30px]'>
						{children}
					</div>
					<ImmersiveDialogClose />
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}

// TODO: consider splitting this into two components, one for the left side and one for the right side
export function ImmersiveDialogSplit({
	children,
	leftChildren,
	onClose,
}: {
	children: React.ReactNode
	leftChildren: React.ReactNode
	onClose?: () => void
}) {
	return (
		<Dialog defaultOpen onOpenChange={afterDelayedClose(onClose)}>
			<DialogPortal>
				{/* Not using anymore because overlay is added elsewhere */}
				{/* <ImmersiveDialogOverlay /> */}
				{/* shell */}
				<DialogContent
					className={cn(
						dialogContentClass,
						immersiveContentSizeClass,
						'flex flex-row justify-between gap-0 bg-black/40 p-0',
					)}
				>
					<div className='hidden w-[210px] flex-col items-center justify-center md:flex'>{leftChildren}</div>
					<div className='flex-1 rounded-20 bg-dialog-content/70 md:rounded-l-none md:rounded-r-20 md:px-4'>
						<div className='umbrel-dialog-fade-scroller flex h-full flex-col gap-6 overflow-y-auto px-4 py-8'>
							{children}
						</div>
					</div>
					<ImmersiveDialogClose />
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}

const immersiveContentSizeClass = tw`top-[calc(50%-30px)] max-h-[800px] w-[calc(100%-40px)] max-w-[800px] h-[calc(100dvh-90px)]`

function ForwardedImmersiveDialogOverlay(props: unknown, ref: ForwardedRef<HTMLDivElement>) {
	return (
		<DialogOverlay
			ref={ref}
			className={cn(dialogOverlayClass, 'bg-black/30 backdrop-blur-xl contrast-more:backdrop-blur-none')}
		/>
	)
}

const ImmersiveDialogOverlay = forwardRef(ForwardedImmersiveDialogOverlay)

function ImmersiveDialogClose() {
	return (
		<div className='absolute left-1/2 top-full mt-5 -translate-x-1/2'>
			{/* Note, because this parent has a backdrop, this button won't have a backdrop */}
			<DialogClose asChild>
				<IconButton
					icon={RiCloseLine}
					className='dialog-shadow h-[36px] w-[36px] border-none bg-dialog-content hover:bg-dialog-content active:bg-dialog-content'
					style={{
						boxShadow: '0px 32px 32px 0px rgba(0, 0, 0, 0.32), 1px 1px 1px 0px rgba(255, 255, 255, 0.08) inset',
					}}
				/>
			</DialogClose>
		</div>
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
	bodyText: string
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
			<div className='text-15 font-medium leading-none -tracking-4 text-white/90'>{bodyText}</div>
			<motion.div className='w-full space-y-2.5'>
				{Children.map(children, (child, i) => (
					<motion.div
						key={i}
						initial={{opacity: 0, translateY: 10}}
						animate={{opacity: 1, translateY: 0}}
						transition={{delay: i * 0.2 + 0.1}}
					>
						{child}
					</motion.div>
				))}
			</motion.div>
			<div className='flex-1' />
			<ImmersiveDialogFooter>{footer}</ImmersiveDialogFooter>
		</div>
	)
}

export function ImmersiveDialogFooter({children}: {children: React.ReactNode}) {
	return <div className='flex w-full flex-wrap-reverse items-center gap-2'>{children}</div>
}

export function ImmersiveDialogIconMessage({
	icon,
	title,
	description,
	className,
	iconClassName,
}: {
	icon: IconType | LucideIcon
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
				<div className='text-13 font-normal leading-tight -tracking-2'>{title}</div>
				{description && (
					<div className='text-12 font-normal leading-tight -tracking-2 text-white/50'>{description}</div>
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
	icon: IconType | LucideIcon
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
				<div className='flex-1 font-normal leading-tight -tracking-2 opacity-60'>{k}</div>
				<div className='font-medium leading-tight -tracking-2'>{v}</div>
			</div>
		</div>
	)
}
