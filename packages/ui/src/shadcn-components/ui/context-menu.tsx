import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import {Check, ChevronRight, Circle} from 'lucide-react'
import * as React from 'react'

import {cn} from '@/shadcn-lib/utils'

import {contextMenuClasses} from './shared/menu'

const ContextMenu = ContextMenuPrimitive.Root

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

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
		<ContextMenuPrimitive.SubContent
			ref={ref}
			className={cn(contextMenuClasses.content, className)}
			{...props}
			// Prevent right-clicks within subcontent from triggering parent context menus
			onContextMenu={(e) => {
				e.preventDefault() // Prevent default browser context menu
				e.stopPropagation()
			}}
		/>
	)
}

function ContextMenuContent({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> & {
	ref?: React.Ref<React.ComponentRef<typeof ContextMenuPrimitive.Content>>
}) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				ref={ref}
				className={cn(contextMenuClasses.content, className)}
				{...props}
				// Prevent right-clicks within content from triggering parent context menus
				onContextMenu={(e) => {
					e.preventDefault() // Prevent default browser context menu
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
