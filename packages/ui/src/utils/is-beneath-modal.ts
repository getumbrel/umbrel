// What a modal was hiding as each key went down. Noted ahead of every other
// listener, because a key can close the modal it was pressed in: that Escape
// reaches the page's own listeners with the modal already gone.
const hiddenAsKeyWentDown = new WeakMap<KeyboardEvent, Element[]>()

window.addEventListener(
	'keydown',
	(event) => hiddenAsKeyWentDown.set(event, [...document.querySelectorAll('[aria-hidden="true"]')]),
	{capture: true},
)

/**
 * Whether a modal layer (a dialog, a drawer, an open menu) was up over
 * `element` when the key of `event` went down.
 *
 * For window-level shortcuts, which hear every key pressed on the page. With a
 * modal up the keys are the modal's, so a page checks this against an element
 * of its own and stands down. Radix hides everything outside a modal from
 * assistive tech for as long as it's open, which makes `aria-hidden` the one
 * signal that holds for all of them, wherever focus happens to sit. And it is
 * relative: Files embedded inside a modal (Rewind) keeps its keys there, while
 * the Files page beneath that modal doesn't.
 */
export function isBeneathModal(element: Element | null, event: KeyboardEvent) {
	if (!element) return false
	return (hiddenAsKeyWentDown.get(event) ?? []).some((hidden) => hidden.contains(element))
}
