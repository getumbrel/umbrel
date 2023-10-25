import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

const menuContentClass = tw`z-50 min-w-[8rem] overflow-hidden p-1 backdrop-blur-2xl backdrop-saturate-[180%] animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 bg-neutral-900/50 text-white`

const menuItemClass = tw`relative flex cursor-default select-none items-center px-3 py-2 text-13 font-medium -tracking-3 leading-tight outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-white/5 focus:text-white`
const menuItemDestructiveClass = cn(
	menuItemClass,
	tw`text-destructive2-lighter focus:text-destructive2-lighter focus:bg-destructive2-lighter/10`,
)

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
