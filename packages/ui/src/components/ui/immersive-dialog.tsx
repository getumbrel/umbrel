import {Dialog, DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogTrigger} from '@radix-ui/react-dialog'
import {motion} from 'framer-motion'
import {Children, ComponentPropsWithoutRef, ForwardedRef, forwardRef, ReactNode} from 'react'
import {RiCloseLine} from 'react-icons/ri'

import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {
	dialogContentAnimationClass,
	dialogContentAnimationSlideClass,
	dialogContentClass,
	dialogOverlayClass,
} from '@/shadcn-components/ui/shared/dialog'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

import {IconTypes} from './icon'
import {IconButton} from './icon-button'

export const immersiveDialogTitleClass = tw`text-24 font-bold leading-none -tracking-4 text-white/80`
export const immersiveDialogDescriptionClass = tw`text-15 font-normal leading-tight -tracking-2 text-white/40`

export function ImmersiveDialogSeparator() {
	return <hr className='w-full border-white/10' />
}

export const ImmersiveDialog = Dialog
export const ImmersiveDialogTrigger = DialogTrigger

export function ImmersiveDialogContent({
	children,
	size = 'default',
	short = false,
	showScroll = false,
	...contentProps
}: {
	children: React.ReactNode
	size?: 'default' | 'md' | 'lg' | 'xl'
	short?: boolean
	showScroll?: boolean
} & ComponentPropsWithoutRef<typeof DialogContent>) {
	return (
		<DialogContent
			className={cn(
				dialogContentClass,
				dialogContentAnimationClass,
				dialogContentAnimationSlideClass,
				short ? immersiveContentShortClass : immersiveContentTallClass,
				// overrides default size
				size === 'md' && 'max-w-[900px]',
				size === 'lg' && 'max-w-[980px]',
				size === 'xl' && 'max-w-[1440px]',
				'p-0',
			)}
			{...contentProps}
		>
			{showScroll ? (
				<ScrollArea dialogInset className='h-full'>
					<div className={immersiveScrollAreaContentsClass}>{children}</div>
				</ScrollArea>
			) : (
				<div className={immersiveScrollAreaContentsClass}>{children}</div>
			)}
			<ImmersiveDialogClose />
		</DialogContent>
	)
}

export function ImmersiveDialogSplitContent({
	children,
	side,
	...contentProps
}: {children: React.ReactNode; side: React.ReactNode} & ComponentPropsWithoutRef<typeof DialogContent>) {
	return (
		<DialogPortal>
			<ImmersiveDialogOverlay />
			<DialogContent
				className={cn(
					dialogContentClass,
					'bg-transparent shadow-none ring-2 ring-white/3', // remove shadow from `dialogContentClass`
					dialogContentAnimationClass,
					dialogContentAnimationSlideClass,
					immersiveContentTallClass,
					'flex flex-row justify-between gap-0 p-0',
				)}
				{...contentProps}
			>
				<section className='hidden w-[210px] flex-col items-center justify-center bg-black/40 md:flex md:rounded-l-20'>
					{side}
				</section>
				<section className='flex-1 bg-dialog-content/70 max-md:rounded-20 md:rounded-r-20'>
					<ScrollArea dialogInset className='h-full'>
						<div className={immersiveScrollAreaContentsClass}>{children}</div>
					</ScrollArea>
				</section>
				<ImmersiveDialogClose />
			</DialogContent>
		</DialogPortal>
	)
}

const immersiveContentShortClass = tw`w-[calc(100%-40px)] max-w-[800px] max-h-[calc(100dvh-90px)]`
const immersiveContentTallClass = tw`top-[calc(50%-30px)] max-h-[800px] w-[calc(100%-40px)] max-w-[800px] h-[calc(100dvh-90px)]`
const immersiveScrollAreaContentsClass = tw`flex h-full flex-col gap-6 p-4 md:p-8`

function ForwardedImmersiveDialogOverlay(props: unknown, ref: ForwardedRef<HTMLDivElement>) {
	return (
		<DialogOverlay
			ref={ref}
			className={cn(dialogOverlayClass, 'bg-black/30 backdrop-blur-xl contrast-more:backdrop-blur-none')}
		/>
	)
}

export const ImmersiveDialogOverlay = forwardRef(ForwardedImmersiveDialogOverlay)

function ImmersiveDialogClose() {
	return (
		<div className='absolute left-1/2 top-full mt-5 -translate-x-1/2'>
			{/* Note, because this parent has a backdrop, this button won't have a backdrop */}
			<DialogClose asChild>
				<IconButton
					icon={RiCloseLine}
					// Overriding state colors
					className='h-[36px] w-[36px] border-none bg-dialog-content bg-opacity-70 shadow-immersive-dialog-close hover:border-solid hover:bg-dialog-content focus:border-solid focus:bg-dialog-content active:bg-dialog-content'
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
				<div className='flex-1 font-normal leading-tight -tracking-2 opacity-60'>{k}</div>
				<div className='font-medium leading-tight -tracking-2'>{v}</div>
			</div>
		</div>
	)
}
