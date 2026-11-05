import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

import {floatingContentAnimationClass, materialSurfaceClasses} from './material'

// Removed `data-[state=closed]:animate-out` here so the context menu moves with
// the cursor on subsequent right clicks. Appears to be a shadcn/ui bug, as it's
// also behaving this way at https://ui.shadcn.com/docs/components/context-menu
// Never wider than the screen less the 8px the menus keep from each edge, so
// a long item (a description, a longer translation) wraps instead of running
// the menu off a phone's edge.
const menuContentClass = cn(
	tw`z-50 min-w-[8rem] max-w-[calc(100vw-16px)] p-1 text-white outline-hidden`,
	floatingContentAnimationClass,
)

const menuItemClass = tw`relative flex cursor-default items-center px-3 py-2 text-13 font-medium -tracking-3 leading-tight outline-hidden data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-white/10 focus:text-white data-[highlighted]:bg-white/10 data-[highlighted]:text-white`
const menuItemDestructiveClass = cn(menuItemClass, tw`text-destructive2-lightest focus:text-destructive2-lightest`)

const checkboxIndicatorWrapperClass = tw`absolute right-3 flex h-3.5 w-3.5 items-center justify-center`
const radioIndicatorWrapperClass = tw`absolute left-2 flex h-3.5 w-3.5 items-center justify-center`

const contextMenuItemClass = cn(menuItemClass, 'umbrel-material-menu-item')

export const contextMenuClasses = {
	content: cn(menuContentClass, materialSurfaceClasses.contextMenu),
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

const dropdownItemClass = cn(menuItemClass, 'umbrel-material-menu-item')
export const dropdownClasses = {
	content: cn(menuContentClass, materialSurfaceClasses.dropdown),
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
