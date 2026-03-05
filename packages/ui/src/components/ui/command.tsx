import * as DialogPrimitive from '@radix-ui/react-dialog'
import {DialogProps} from '@radix-ui/react-dialog'
import {Command as CommandPrimitive} from 'cmdk'
import * as React from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {mergeRefs} from 'react-merge-refs'

import {AppIcon} from '@/components/app-icon'
import {useFadeScroller} from '@/components/fade-scroller'
import {Dialog} from '@/components/ui/dialog'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'

import {dialogContentAnimationClass, dialogContentClass, dialogOverlayClass} from './shared/dialog'

function Command({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive> & {
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive>>
}) {
	return (
		<CommandPrimitive ref={ref} className={cn('flex h-full w-full flex-col overflow-hidden', className)} {...props} />
	)
}

type CommandDialogProps = DialogProps

const CommandDialog = ({children, ...props}: CommandDialogProps) => {
	return (
		<Dialog {...props}>
			<BlurOverlay />
			<DialogPrimitive.Content
				className={cn(
					dialogContentClass,
					dialogContentAnimationClass,
					'data-[state=closed]:slide-out-to-top-0 data-[state=open]:slide-in-from-top-0',
					'top-4 translate-y-0 overflow-hidden p-3 md:p-[30px] lg:top-[10%]',
					'w-full max-w-[calc(100%-40px)] sm:max-w-[700px]',
					'z-[999]',
				)}
			>
				<Command
					loop
					className='[&_[cmdk-group-heading]]:font-medium[&_[cmdk-group-heading]]:text-neutral-400 flex flex-col gap-3 md:gap-5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0'
				>
					{children}
				</Command>
			</DialogPrimitive.Content>
		</Dialog>
	)
}

function CommandInput({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive.Input>>
}) {
	return (
		<div className='flex items-center pr-2' cmdk-input-wrapper=''>
			<CommandPrimitive.Input
				ref={ref}
				className={cn(
					'flex w-full rounded-md bg-transparent p-2 text-15 font-medium -tracking-2 outline-hidden placeholder:text-white/25 disabled:cursor-not-allowed disabled:opacity-50',
					className,
				)}
				{...props}
			/>
			<CommandCloseButton />
		</div>
	)
}

function CommandList({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.List> & {
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive.List>>
}) {
	const {scrollerClass, ref: localRef} = useFadeScroller('y')
	return (
		<CommandPrimitive.List
			ref={mergeRefs([localRef, ref])}
			className={cn(scrollerClass, 'overflow-x-hidden overflow-y-auto', className)}
			{...props}
		/>
	)
}

function CommandEmpty({
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty> & {
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive.Empty>>
}) {
	return <CommandPrimitive.Empty ref={ref} className='py-6 text-center text-sm' {...props} />
}

function CommandGroup({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group> & {
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive.Group>>
}) {
	return <CommandPrimitive.Group ref={ref} className={cn('overflow-hidden text-neutral-50', className)} {...props} />
}

function CommandSeparator({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator> & {
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive.Separator>>
}) {
	return <CommandPrimitive.Separator ref={ref} className={cn('-mx-1 h-px bg-white', className)} {...props} />
}

// Accept either a string (image source URL) or a React node for the icon
type CommandItemIcon = string | React.ReactNode

function CommandItem({
	className,
	ref,
	icon,
	children,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item> & {
	icon?: CommandItemIcon
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive.Item>>
}) {
	const isMobile = useIsMobile()
	return (
		<CommandPrimitive.Item
			ref={ref}
			className={cn(
				'group relative flex cursor-default items-center gap-3 rounded-8 p-2 text-13 font-medium -tracking-2 outline-hidden aria-selected:bg-white/4 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 md:text-15',
				className,
			)}
			{...props}
		>
			{icon &&
				(typeof icon === 'string' ? (
					<AppIcon src={icon} size={isMobile ? 24 : 36} className='rounded-6 sm:rounded-8' />
				) : (
					// When a custom React node is provided, we still want to constrain its
					// dimensions so spacing stays consistent across command items.
					<span
						className='flex items-center justify-center'
						style={{
							width: isMobile ? '24px' : '36px',
							height: isMobile ? '24px' : '36px',
						}}
					>
						{icon}
					</span>
				))}
			{children}
			<CommandShortcut className='mr-1 hidden group-aria-selected:block'>↵</CommandShortcut>
		</CommandPrimitive.Item>
	)
}

const CommandShortcut = ({className, ...props}: React.HTMLAttributes<HTMLSpanElement>) => {
	return <span className={cn('ml-auto text-xs tracking-widest text-white/30', className)} {...props} />
}

export {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
}

function BlurOverlay({ref}: {ref?: React.Ref<HTMLDivElement>}) {
	return (
		<DialogPrimitive.DialogOverlay
			ref={ref}
			className={cn(dialogOverlayClass, 'z-[999] bg-black/30 backdrop-blur-xl contrast-more:backdrop-blur-none')}
		/>
	)
}

const CommandCloseButton = () => (
	<DialogPrimitive.Close className='rounded-full opacity-30 ring-white/60 outline-hidden transition-opacity hover:opacity-40 focus-visible:opacity-40 focus-visible:ring-2'>
		<RiCloseCircleFill className='h-[18px] w-[18px] md:h-5 md:w-5' />
		<span className='sr-only'>Close</span>
	</DialogPrimitive.Close>
)
