import {tw} from '@/utils/tw'

/**
 * Semantic material roles. The visual values live in CSS custom properties in
 * index.css so designers can tune the whole system without touching component
 * markup.
 */
export const materialSurfaceClasses = {
	contextMenu: tw`umbrel-material umbrel-material-context-menu`,
	dropdown: tw`umbrel-material umbrel-material-dropdown`,
	popover: tw`umbrel-material umbrel-material-popover`,
	modal: tw`umbrel-material umbrel-material-modal`,
	toast: tw`umbrel-material umbrel-material-toast`,
}

// With reduced motion, menus and popovers only fade
export const floatingContentAnimationClass = tw`animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=left]:slide-in-from-right-2 motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2`
