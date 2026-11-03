import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import {Check, ChevronRight, Circle} from 'lucide-react'
import * as React from 'react'

import {cn} from '@/lib/utils'
import {allowsNativeContextMenu} from '@/utils/native-context-menu'

import {contextMenuClasses} from './shared/menu'

const ContextMenu = ContextMenuPrimitive.Root

function ContextMenuTrigger({
	onContextMenuCapture,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
	return (
		<ContextMenuPrimitive.Trigger
			{...props}
			onContextMenuCapture={(e) => {
				onContextMenuCapture?.(e)
				// A text field inside the trigger (a rename, the Files path) gets the browser's text menu: stopping
				// the event on its way down keeps it from the trigger and from the document's blocker
				if (allowsNativeContextMenu(e.target)) e.stopPropagation()
			}}
		/>
	)
}

const ContextMenuGroup = ContextMenuPrimitive.Group

const ContextMenuPortal = ContextMenuPrimitive.Portal

const ContextMenuSub = ContextMenuPrimitive.Sub

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

function ContextMenuSubTrigger({
	className,
	inset,
	children,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
	inset?: boolean
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.SubTrigger>>
}) {
	return (
		<ContextMenuPrimitive.SubTrigger
			ref={ref}
			className={cn(contextMenuClasses.item.root, inset && 'pl-8', className)}
			{...props}
		>
			{children}
			<ChevronRight className='ml-auto h-4 w-4' />
		</ContextMenuPrimitive.SubTrigger>
	)
}

function ContextMenuSubContent({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent> & {
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.SubContent>>
}) {
	return (
		// Portalled so the parent menu's backdrop-filter doesn't become this
		// element's backdrop root, which would make its own backdrop-filter
		// sample an empty region wherever it extends past the parent menu.
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.SubContent
				ref={ref}
				className={cn(contextMenuClasses.content, className)}
				{...props}
				// Keep right-clicks inside from opening an ancestor's context menu, while text fields keep the browser's own
				onContextMenu={(e) => {
					if (!allowsNativeContextMenu(e.target)) e.preventDefault()
					e.stopPropagation()
				}}
			/>
		</ContextMenuPrimitive.Portal>
	)
}

function ContextMenuContent({
	className,
	collisionPadding = 8,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> & {
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.Content>>
}) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				ref={ref}
				collisionPadding={collisionPadding}
				className={cn(contextMenuClasses.content, className)}
				{...props}
				// Keep right-clicks inside from opening an ancestor's context menu, while text fields keep the browser's own
				onContextMenu={(e) => {
					if (!allowsNativeContextMenu(e.target)) e.preventDefault()
					e.stopPropagation()
				}}
			/>
		</ContextMenuPrimitive.Portal>
	)
}

function ContextMenuItem({
	className,
	inset,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
	inset?: boolean
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.Item>>
}) {
	return (
		<ContextMenuPrimitive.Item
			ref={ref}
			className={cn(contextMenuClasses.item.root, inset && 'pl-8', className)}
			{...props}
		/>
	)
}

function ContextMenuCheckboxItem({
	className,
	children,
	checked,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem> & {
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.CheckboxItem>>
}) {
	return (
		<ContextMenuPrimitive.CheckboxItem
			ref={ref}
			className={cn(contextMenuClasses.checkboxItem.root, className)}
			checked={checked}
			{...props}
		>
			<span className={contextMenuClasses.checkboxItem.indicatorWrapper}>
				<ContextMenuPrimitive.ItemIndicator>
					<Check className='h-4 w-4' />
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</ContextMenuPrimitive.CheckboxItem>
	)
}

function ContextMenuRadioItem({
	className,
	children,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem> & {
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.RadioItem>>
}) {
	return (
		<ContextMenuPrimitive.RadioItem ref={ref} className={cn(contextMenuClasses.radioItem.root, className)} {...props}>
			<span className={contextMenuClasses.radioItem.indicatorWrapper}>
				<ContextMenuPrimitive.ItemIndicator>
					<Circle className='h-4 w-4 fill-current' />
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</ContextMenuPrimitive.RadioItem>
	)
}

function ContextMenuLabel({
	className,
	inset,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
	inset?: boolean
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.Label>>
}) {
	return (
		<ContextMenuPrimitive.Label
			ref={ref}
			className={cn(
				'px-2 py-1.5 text-sm font-semibold text-neutral-950 dark:text-neutral-50',
				inset && 'pl-8',
				className,
			)}
			{...props}
		/>
	)
}

function ContextMenuSeparator({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator> & {
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.Separator>>
}) {
	return <ContextMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-white/5', className)} {...props} />
}

const ContextMenuShortcut = ({className, ...props}: React.HTMLAttributes<HTMLSpanElement>) => {
	return (
		<span
			className={cn('ml-auto text-xs tracking-widest text-neutral-500 dark:text-neutral-400', className)}
			{...props}
		/>
	)
}

export {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuCheckboxItem,
	ContextMenuRadioItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuGroup,
	ContextMenuPortal,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuRadioGroup,
}
