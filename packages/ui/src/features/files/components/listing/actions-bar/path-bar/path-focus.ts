import {useRef} from 'react'

import {tw} from '@/utils/tw'

// The path is the bar's title, and a box drawn round a word of a title reads
// as a fault. Under the keyboard a folder lights up as it does under the
// pointer, and no ring is drawn.
export const pathFocusClass = tw`outline-hidden focus-visible:text-white/90`

// A menu gives the focus back to its button as it closes, which is what the
// keyboard needs to carry on from there. Opened with the pointer there is
// nothing to carry on: the button would only be left lit, looking pressed.
// So the focus goes back only to a button the keyboard opened.
export function useMenuFocusReturn() {
	const byPointer = useRef(false)
	return {
		trigger: {
			onPointerDown: () => {
				byPointer.current = true
			},
			onKeyDown: () => {
				byPointer.current = false
			},
		},
		content: {
			onCloseAutoFocus: (event: Event) => {
				if (byPointer.current) event.preventDefault()
				byPointer.current = false
			},
		},
	}
}
