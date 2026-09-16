import * as DialogPrimitive from '@radix-ui/react-dialog'
import {DialogProps} from '@radix-ui/react-dialog'
import {Command as CommandPrimitive} from 'cmdk'
import * as React from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {mergeRefs} from 'react-merge-refs'

import {AppIcon} from '@/components/app-icon'
import {useFadeScroller} from '@/components/fade-scroller'
import {Dialog} from '@/components/ui/dialog'
import {cn} from '@/lib/utils'

import {dialogOverlayClass, preventDialogDismissForToasts} from './shared/dialog'

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

type CommandDialogProps = DialogProps & {
	contentClassName?: string
	// Passed straight to the cmdk root: a controlled `value`, `onValueChange`…
	commandProps?: Omit<React.ComponentPropsWithoutRef<typeof CommandPrimitive>, 'children'>
	onEscapeKeyDown?: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>['onEscapeKeyDown']
}

// The dialog is a transparent stage; whatever it holds (the search orb, the
// results card) paints and animates itself. Radix keeps the stage mounted for
// as long as an animation runs on it, so a no-op hold on close (see
// `.cmdk-stage` in index.css) gives the children time to leave.
const CommandDialog = ({children, contentClassName, commandProps, onEscapeKeyDown, ...props}: CommandDialogProps) => {
	const {className: commandClassName, ...restCommandProps} = commandProps ?? {}
	return (
		<Dialog {...props}>
			<BlurOverlay />
			<DialogPrimitive.Content
				onPointerDownOutside={preventDialogDismissForToasts}
				onEscapeKeyDown={onEscapeKeyDown}
				aria-describedby={undefined}
				className={cn(
					'cmdk-stage fixed left-1/2 z-[999] flex -translate-x-1/2 flex-col items-center outline-hidden',
					'top-4 max-h-[calc(100dvh-32px)] w-full max-w-[calc(100%-32px)] sm:max-w-[720px] lg:top-[8%] lg:max-h-[84dvh]',
					contentClassName,
				)}
			>
				<Command
					loop
					// Rows are ranked in JS before they're rendered (see cmdk-search.ts), so
					// cmdk must not re-score or reorder them
					shouldFilter={false}
					className={cn('min-h-0 items-center overflow-visible', commandClassName)}
					{...restCommandProps}
				>
					{children}
				</Command>
			</DialogPrimitive.Content>
		</Dialog>
	)
}

function CommandInput({
	className,
	wrapperClassName,
	leading,
	trailing,
	onClear,
	clearLabel = 'Clear',
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive.Input>>
	wrapperClassName?: string
	// Decoration before the field (a search glyph) and after it (a scope chip).
	// Without `trailing` the dialog's close button takes that slot.
	leading?: React.ReactNode
	trailing?: React.ReactNode
	// Shows a clear button while the (controlled) value is non-empty
	onClear?: () => void
	clearLabel?: string
}) {
	const localRef = React.useRef<HTMLInputElement>(null)
	const hasValue = typeof props.value === 'string' && props.value.length > 0
	return (
		<div className={cn('flex items-center pr-2', wrapperClassName)} cmdk-input-wrapper=''>
			{leading && <span className='flex shrink-0 items-center justify-center text-white/45'>{leading}</span>}
			<CommandPrimitive.Input
				ref={mergeRefs([localRef, ref])}
				className={cn(
					'flex w-full min-w-0 rounded-md bg-transparent p-2 text-15 font-medium -tracking-2 outline-hidden placeholder:text-white/25 disabled:cursor-not-allowed disabled:opacity-50',
					className,
				)}
				{...props}
			/>
			{onClear && hasValue && (
				<button
					type='button'
					aria-label={clearLabel}
					className='mr-1 flex shrink-0 items-center rounded-full text-white/30 outline-hidden transition-colors hover:text-white/55 focus-visible:ring-2 focus-visible:ring-ring'
					// Keep the caret in the field: the clear must not blur it
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => {
						onClear()
						localRef.current?.focus()
					}}
				>
					<RiCloseCircleFill className='size-[18px]' />
				</button>
			)}
			{trailing ?? <CommandCloseButton />}
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
			className={cn(scrollerClass, 'min-h-0 overflow-x-hidden overflow-y-auto', className)}
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
	iconVariant = 'bare',
	showShortcut = true,
	children,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item> & {
	icon?: CommandItemIcon
	iconVariant?: 'bare' | 'tile'
	// The ↵ hint on the selected row; tiles and links do without
	showShortcut?: boolean
	ref?: React.Ref<React.ComponentRef<typeof CommandPrimitive.Item>>
}) {
	return (
		<CommandPrimitive.Item
			ref={ref}
			className={cn(
				'group relative flex cursor-default items-center gap-3 rounded-8 p-2 text-13 font-medium -tracking-2 outline-hidden aria-selected:bg-white/6 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 md:text-15',
				className,
			)}
			{...props}
		>
			{icon &&
				(typeof icon === 'string' ? (
					<AppIcon
						src={icon}
						className={cn(
							'size-6 lg:size-9',
							iconVariant === 'tile' ? 'rounded-6 sm:rounded-8' : 'border-0 bg-transparent object-contain',
						)}
					/>
				) : (
					// When a custom React node is provided, we still want to constrain its
					// dimensions so spacing stays consistent across command items.
					<span className='flex size-6 shrink-0 items-center justify-center lg:size-9'>{icon}</span>
				))}
			{children}
			{showShortcut && <CommandShortcut className='mr-1 hidden group-aria-selected:block'>↵</CommandShortcut>}
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
