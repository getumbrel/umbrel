import type RFB from '@novnc/novnc'

const XK_SUPER_L = 0xffeb
const XK_ALT_L = 0xffe9
const XK_TAB = 0xff09

// Keys the computer in front of you acts on before a browser can pass them on:
// the Windows key opens its own Start menu, Alt+Tab switches its own apps, and
// Ctrl+Alt+Delete never reaches a page at all. The console's controls send them
// instead.
export type ConsoleKey = 'super' | 'ctrl-alt-delete' | 'alt-tab'

const CONSOLE_KEY_EVENT = 'umbrel:machine-console-key'
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta'])

// The controls sit outside the console, in the rail and the fullscreen header,
// so a press reaches the machine's console as an event. Returns whether a
// console took it, and with it the keyboard focus.
export function pressConsoleKey(machineId: string, key: ConsoleKey) {
	return !window.dispatchEvent(new CustomEvent(CONSOLE_KEY_EVENT, {detail: {machineId, key}, cancelable: true}))
}

// Sends the pressed keys to the guest. Super stays down for the shortcut it
// starts, so it works with any key on the keyboard and with the mouse: it
// comes up with the next key or mouse button, or when it's pressed again, which
// makes a tap of its own (GNOME and Windows open their launchers on one).
export function listenForConsoleKeys({
	machineId,
	rfb,
	screen,
	canSend,
	onSuperHeld,
}: {
	machineId: string
	rfb: RFB
	// Where noVNC hears the keyboard and mouse
	screen: HTMLElement
	canSend: () => boolean
	onSuperHeld: (held: boolean) => void
}) {
	let superHeld = false
	let shortcutStarted = false

	const holdSuper = (held: boolean) => {
		if (held === superHeld) return
		superHeld = held
		shortcutStarted = false
		rfb.sendKey(XK_SUPER_L, 'MetaLeft', held)
		onSuperHeld(held)
	}

	const onConsoleKey = (event: Event) => {
		const {detail} = event as CustomEvent<{machineId: string; key: ConsoleKey}>
		if (detail.machineId !== machineId || !canSend()) return
		event.preventDefault()
		if (detail.key === 'super') holdSuper(!superHeld)
		else if (detail.key === 'ctrl-alt-delete') rfb.sendCtrlAltDel()
		else {
			rfb.sendKey(XK_ALT_L, 'AltLeft', true)
			rfb.sendKey(XK_TAB, 'Tab')
			rfb.sendKey(XK_ALT_L, 'AltLeft', false)
		}
		// The rest of a shortcut is typed, and noVNC only hears the keyboard
		// while its canvas has the focus
		rfb.focus()
	}
	// Other modifiers join the shortcut without being the end of it
	const onKeyDown = (event: KeyboardEvent) => {
		if (superHeld && !MODIFIER_KEYS.has(event.key)) shortcutStarted = true
	}
	const onKeyUp = (event: KeyboardEvent) => {
		if (shortcutStarted && !MODIFIER_KEYS.has(event.key)) holdSuper(false)
	}
	const onMouseDown = () => {
		if (superHeld) shortcutStarted = true
	}
	const onMouseUp = () => {
		if (shortcutStarted) holdSuper(false)
	}

	window.addEventListener(CONSOLE_KEY_EVENT, onConsoleKey)
	// Captured, because noVNC stops the events it forwards. Mouse rather than
	// pointer events, because noVNC takes over the pointer while a button is
	// down and hands its canvas only the mouse events.
	screen.addEventListener('keydown', onKeyDown, true)
	screen.addEventListener('keyup', onKeyUp, true)
	screen.addEventListener('mousedown', onMouseDown, true)
	screen.addEventListener('mouseup', onMouseUp, true)
	return () => {
		window.removeEventListener(CONSOLE_KEY_EVENT, onConsoleKey)
		screen.removeEventListener('keydown', onKeyDown, true)
		screen.removeEventListener('keyup', onKeyUp, true)
		screen.removeEventListener('mousedown', onMouseDown, true)
		screen.removeEventListener('mouseup', onMouseUp, true)
		holdSuper(false)
	}
}
