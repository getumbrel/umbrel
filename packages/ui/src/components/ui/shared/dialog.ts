import {tw} from '@/utils/tw'

import {materialSurfaceClasses} from './material'

export const dialogOverlayClass = tw`fixed inset-0 z-50 bg-black/60 contrast-more:bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0`

// Under 500px tall a window scrolls instead of running off the screen: a short
// browser, or a tablet's window with the Android app's keyboard up
export const dialogContentClass = `${materialSurfaceClasses.modal} fixed left-[calc(50%+var(--safe-center-shift))] top-[calc(50%+var(--safe-top)/2)] z-50 flex flex-col translate-x-[-50%] translate-y-[-50%] gap-5 p-8 duration-200 outline-hidden max-h-[calc(100%-16px-var(--safe-top))] low:overflow-y-auto`
// With reduced motion, dialogs only fade
export const dialogContentAnimationClass = tw`data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95`
export const dialogContentAnimationSlideClass = tw``

// One button order for every dialog. Put the primary action first in the markup:
// stacked on phones it sits on top, and from md up the row reverses so Cancel
// comes first and the primary action sits on the trailing edge, as on macOS.
// Keyboard focus still lands on the primary action first. A pair too wide for
// the row wraps, primary first, instead of running out of the dialog.
export const dialogFooterClass = tw`flex flex-col gap-2.5 md:flex-row-reverse md:flex-wrap`

/**
 * Radix modals treat any pointerdown outside their content as a dismiss
 * request, and toasts always render outside dialog content — without this
 * guard, clicking a toast closes the dialog instead of reaching the toast.
 */
export function preventDialogDismissForToasts(event: {target: EventTarget | null; preventDefault: () => void}) {
	if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]')) {
		event.preventDefault()
	}
}
