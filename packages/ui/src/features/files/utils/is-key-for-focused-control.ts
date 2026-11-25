const CONTROL_SELECTOR = [
	'button',
	'a[href]',
	'summary',
	'select',
	...['button', 'link', 'menuitem', 'tab', 'treeitem', 'checkbox', 'radio', 'switch', 'option'].map(
		(role) => `[role="${role}"]`,
	),
].join(', ')

// Whether the keyboard (Tab) or a pointer moved focus last. Chrome leaves focus on
// a button after a click, and a menu hands it back to its trigger, so a control can
// hold focus without the user having gone to it
let focusedFromKeyboard = false
window.addEventListener(
	'keydown',
	(event) => {
		if (event.key === 'Tab') focusedFromKeyboard = true
	},
	{capture: true},
)
window.addEventListener(
	'pointerdown',
	() => {
		focusedFromKeyboard = false
	},
	{capture: true},
)

/**
 * Whether a key went to a control the user tabbed to rather than to the listing:
 * Space and Enter press that button (or follow that link), so the listing's
 * window-level Space (Quick Look) and Enter (rename) stand down. After a click,
 * they stay the listing's, as before.
 */
export function isKeyForFocusedControl(event: KeyboardEvent) {
	return focusedFromKeyboard && event.target instanceof Element && event.target.matches(CONTROL_SELECTOR)
}
