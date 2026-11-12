import {useRef} from 'react'

type AutoFocusHandlers = {
	onOpenAutoFocus?: (event: Event) => void
	onCloseAutoFocus?: (event: Event) => void
}

/**
 * Puts focus back where it was when a dialog closes.
 *
 * Radix returns focus to the dialog's Trigger, but umbrelOS opens its dialogs from
 * links and state (`?dialog=` in the URL, a menu item) rather than Triggers, so a
 * closed dialog left focus on <body> and a keyboard user started over from the top
 * of the page. This notes what had focus as the dialog opened and focuses it again
 * on close, if it's still on the page. A caller that places close focus itself
 * (calling preventDefault) keeps that.
 */
export function useReturnFocus({onOpenAutoFocus, onCloseAutoFocus}: AutoFocusHandlers) {
	const opener = useRef<HTMLElement | null>(null)
	return {
		onOpenAutoFocus: (event: Event) => {
			opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
			onOpenAutoFocus?.(event)
		},
		onCloseAutoFocus: (event: Event) => {
			onCloseAutoFocus?.(event)
			const target = opener.current
			opener.current = null
			if (event.defaultPrevented || !target?.isConnected || target === document.body) return
			event.preventDefault()
			target.focus({preventScroll: true})
		},
	} satisfies AutoFocusHandlers
}
