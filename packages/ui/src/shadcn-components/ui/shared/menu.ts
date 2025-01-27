import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

// Removed `data-[state=closed]:animate-out` here so the context menu moves with
// the cursor on subsequent right clicks. Appears to be a shadcn/ui bug, as it's
// also behaving this way at https://ui.shadcn.com/docs/components/context-menu
// Removed bg-blur in favor of bg with color-mix as bg-blur doesn't work on subcontext menus
const menuContentClass = tw`bg-[color-mix(in_hsl,hsl(var(--color-brand))_20%,black_80%)] z-50 min-w-[8rem] p-1 animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 text-white`

const menuItemClass = tw`relative flex cursor-default select-none items-center px-3 py-2 text-13 font-medium -tracking-3 leading-tight outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-white/5 focus:text-white data-[highlighted]:bg-white/5 data-[highlighted]:text-white`
const menuItemDestructiveClass = cn(menuItemClass, tw`text-destructive2-lightest focus:text-destructive2-lightest`)

const checkboxIndicatorWrapperClass = tw`absolute right-3 flex h-3.5 w-3.5 items-center justify-center`
const radioIndicatorWrapperClass = tw`absolute left-2 flex h-3.5 w-3.5 items-center justify-center`

const contextMenuItemClass = cn(menuItemClass, 'rounded-5')

export const contextMenuClasses = {
	content: cn(menuContentClass, 'shadow-context-menu rounded-8'),
	item: {
		root: contextMenuItemClass,
		rootDestructive: menuItemDestructiveClass,
	},
	checkboxItem: {
		root: cn(contextMenuItemClass, 'pr-10'),
		indicatorWrapper: checkboxIndicatorWrapperClass,
	},
	radioItem: {
		root: cn(contextMenuItemClass, 'pl-8'),
		indicatorWrapper: radioIndicatorWrapperClass,
	},
}

const dropdownItemClass = cn(menuItemClass, 'rounded-8')
export const dropdownClasses = {
	content: cn(menuContentClass, 'shadow-dropdown rounded-15 p-2.5'),
	item: {
		root: dropdownItemClass,
	},
	checkboxItem: {
		root: cn(dropdownItemClass, 'pr-10'),
		indicatorWrapper: checkboxIndicatorWrapperClass,
	},
	radioItem: {
		root: cn(dropdownItemClass, 'pl-8'),
		indicatorWrapper: radioIndicatorWrapperClass,
	},
}
