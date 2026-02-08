import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import {Check, ChevronRight, Circle} from 'lucide-react'
import * as React from 'react'

import {cn} from '@/shadcn-lib/utils'

import {dropdownClasses} from './shared/menu'

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

function DropdownMenuSubTrigger({
	className,
	inset,
	children,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
	inset?: boolean
	ref?: React.Ref<React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>>
}) {
	return (
		<DropdownMenuPrimitive.SubTrigger
			ref={ref}
			className={cn(dropdownClasses.item.root, inset && 'pl-8', className)}
			{...props}
		>
			{children}
			<ChevronRight className='ml-auto h-4 w-4' />
		</DropdownMenuPrimitive.SubTrigger>
	)
}

function DropdownMenuSubContent({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> & {
	ref?: React.Ref<React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>>
}) {
	return (
		<DropdownMenuPrimitive.SubContent
			ref={ref}
			className={cn(dropdownClasses.content, className)}
			{...props}
			// Prevent right-clicks within subcontent from triggering parent context menus
			onContextMenu={(e) => {
				e.preventDefault() // Prevent default browser context menu
				e.stopPropagation()
			}}
		/>
	)
}

function DropdownMenuContent({
	className,
	sideOffset = 4,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
	ref?: React.Ref<React.ComponentRef<typeof DropdownMenuPrimitive.Content>>
}) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				ref={ref}
				sideOffset={sideOffset}
				className={cn(dropdownClasses.content, className)}
				{...props}
				// Prevent right-clicks within content from triggering parent context menus
				onContextMenu={(e) => {
					e.preventDefault() // Prevent default browser context menu
					e.stopPropagation()
				}}
			/>
		</DropdownMenuPrimitive.Portal>
	)
}

function DropdownMenuItem({
	className,
	inset,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
	inset?: boolean
	ref?: React.Ref<React.ComponentRef<typeof DropdownMenuPrimitive.Item>>
}) {
	return (
		<DropdownMenuPrimitive.Item
			ref={ref}
			className={cn(dropdownClasses.item.root, inset && 'pl-8', className)}
			{...props}
		/>
	)
}

function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & {
	ref?: React.Ref<React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>>
}) {
	return (
		<DropdownMenuPrimitive.CheckboxItem
			ref={ref}
			className={cn(dropdownClasses.checkboxItem.root, className)}
			checked={checked}
			{...props}
		>
			{children}
			<DropdownMenuPrimitive.ItemIndicator className={dropdownClasses.checkboxItem.indicatorWrapper}>
				<Check className='h-4 w-4' />
			</DropdownMenuPrimitive.ItemIndicator>
		</DropdownMenuPrimitive.CheckboxItem>
	)
}

function DropdownMenuRadioItem({
	className,
	children,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & {
	ref?: React.Ref<React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>>
}) {
	return (
		<DropdownMenuPrimitive.RadioItem ref={ref} className={cn(dropdownClasses.radioItem.root, className)} {...props}>
			<span className='absolute left-2 flex h-3.5 w-3.5 items-center justify-center'>
				<DropdownMenuPrimitive.ItemIndicator>
					<Circle className='h-2 w-2 fill-current' />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.RadioItem>
	)
}

function DropdownMenuLabel({
	className,
	inset,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
	inset?: boolean
	ref?: React.Ref<React.ComponentRef<typeof DropdownMenuPrimitive.Label>>
}) {
	return (
		<DropdownMenuPrimitive.Label
			ref={ref}
			className={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
			{...props}
		/>
	)
}

function DropdownMenuSeparator({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator> & {
	ref?: React.Ref<React.ComponentRef<typeof DropdownMenuPrimitive.Separator>>
}) {
	return (
		<DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-2.5 my-2.5 h-px bg-white/5', className)} {...props} />
	)
}

const DropdownMenuShortcut = ({className, ...props}: React.HTMLAttributes<HTMLSpanElement>) => {
	return <span className={cn('ml-auto text-xs tracking-widest opacity-60', className)} {...props} />
}

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuRadioItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuGroup,
	DropdownMenuPortal,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuRadioGroup,
}
