import type RFB from '@novnc/novnc'

const XK_SHIFT_L = 0xffe1
const XK_SHIFT_R = 0xffe2
const XK_CONTROL_L = 0xffe3
const XK_CONTROL_R = 0xffe4
const XK_SUPER_L = 0xffeb
const XK_SUPER_R = 0xffec
const XK_INSERT = 0xff63
const XK_RETURN = 0xff0d
const XK_TAB = 0xff09

// The same pacing umbreld types with: toolkits debounce, so keystrokes need a
// real press and a gap between them
const KEY_HOLD_MS = 25
const KEY_INTERVAL_MS = 12

// umbreld's own limit for typing into a guest. At the pacing below this much
// text already takes minutes.
export const MAX_TYPED_PASTE_LENGTH = 10_000

// Omarchy's clipboard bridge needs a moment to carry pasted text from the agent
// to Wayland, where the guest's paste reads it from
export const OMARCHY_PASTE_DELAY_MS = 250

// Browsers let a page write the clipboard only this soon after a keypress or
// click, and a guest copy that late wasn't the user's anyway
export const USER_COPY_WINDOW_MS = 5_000

export type ClipboardShortcut = {action: 'copy' | 'cut' | 'paste'; fromCommand: boolean}

// Clipboard shortcuts the console handles before noVNC forwards them: the
// keys that make the browser paste, so the local clipboard can reach the guest
// first. On a Mac that's only ⌘V, and ⌘C, ⌘X and ⌘V (and the ⌘⇧ forms Linux
// terminals use) become the Ctrl shortcuts every guest expects, as remote
// desktop apps map them; otherwise ⌘ would arrive as the Super key. Omarchy
// keeps ⌘ as it is, since its own clipboard shortcuts are Super+C/X/V.
export function clipboardShortcut(
	event: KeyboardEvent,
	{mac, omarchy = false}: {mac: boolean; omarchy?: boolean},
): ClipboardShortcut | undefined {
	if (event.altKey) return
	const action = ({c: 'copy', x: 'cut', v: 'paste'} as const)[event.key.toLowerCase()]
	if (mac) {
		if (!action || !event.metaKey || event.ctrlKey) return
		if (!omarchy) return {action, fromCommand: true}
		return action === 'paste' ? {action, fromCommand: false} : undefined
	}
	if (event.metaKey) return
	if (event.code === 'Insert' && event.shiftKey && !event.ctrlKey) return {action: 'paste', fromCommand: false}
	if (action === 'paste' && event.ctrlKey) return {action, fromCommand: false}
}

// Replays an intercepted shortcut in the guest. Modifiers the user holds were
// already forwarded by noVNC, so only the key itself is sent, unless ⌘ has to
// become Ctrl: then Ctrl goes down before ⌘'s Super key comes up, so the guest
// never reads a lone Super tap (GNOME and Windows open their launchers on one).
export function sendClipboardShortcut(rfb: RFB, event: KeyboardEvent, shortcut: ClipboardShortcut) {
	const keysym = event.code === 'Insert' ? XK_INSERT : event.key.toLowerCase().charCodeAt(0)
	if (!shortcut.fromCommand) {
		rfb.sendKey(keysym, event.code)
		return
	}
	rfb.sendKey(XK_CONTROL_L, 'ControlLeft', true)
	rfb.sendKey(XK_SUPER_L, 'MetaLeft', false)
	rfb.sendKey(XK_SUPER_R, 'MetaRight', false)
	rfb.sendKey(keysym, event.code)
	rfb.sendKey(XK_CONTROL_L, 'ControlLeft', false)
}

// Replays a paste shortcut after a delay, by when the user may have let go of
// its modifiers, so it presses them itself
export function sendDelayedPasteShortcut(rfb: RFB, event: KeyboardEvent) {
	const modifiers = [
		...(event.ctrlKey ? ([[XK_CONTROL_L, 'ControlLeft']] as const) : []),
		...(event.shiftKey ? ([[XK_SHIFT_L, 'ShiftLeft']] as const) : []),
		...(event.metaKey ? ([[XK_SUPER_L, 'MetaLeft']] as const) : []),
	]
	for (const [keysym, code] of modifiers) rfb.sendKey(keysym, code, true)
	rfb.sendKey(event.code === 'Insert' ? XK_INSERT : event.key.toLowerCase().charCodeAt(0), event.code)
	for (const [keysym, code] of modifiers) rfb.sendKey(keysym, code, false)
}

// Lets go of a shortcut's modifiers in the guest, which is still holding what
// noVNC forwarded, so they don't combine with text typed in its place. Ctrl goes
// down around Super's release so the guest doesn't read a lone Super tap.
export function releaseShortcutModifiers(rfb: RFB, event: KeyboardEvent) {
	if (event.metaKey) {
		rfb.sendKey(XK_CONTROL_L, 'ControlLeft', true)
		rfb.sendKey(XK_SUPER_L, 'MetaLeft', false)
		rfb.sendKey(XK_SUPER_R, 'MetaRight', false)
		rfb.sendKey(XK_CONTROL_L, 'ControlLeft', false)
	}
	if (event.ctrlKey) {
		rfb.sendKey(XK_CONTROL_L, 'ControlLeft', false)
		rfb.sendKey(XK_CONTROL_R, 'ControlRight', false)
	}
	if (event.shiftKey) {
		rfb.sendKey(XK_SHIFT_L, 'ShiftLeft', false)
		rfb.sendKey(XK_SHIFT_R, 'ShiftRight', false)
	}
}

// Characters a US keyboard reaches through Shift. QEMU types keysyms through
// its US keymap and expects the client to hold Shift itself.
const US_SHIFTED_CHARACTERS = new Set('~!@#$%^&*()_+{}|:"<>?')

function keystroke(character: string) {
	if (character === '\n') return {keysym: XK_RETURN, shift: false}
	if (character === '\t') return {keysym: XK_TAB, shift: false}
	const code = character.charCodeAt(0)
	// QEMU drops keysyms its US keymap has no key for, so only plain ASCII types
	if (character.length !== 1 || code < 0x20 || code > 0x7e) return
	return {keysym: code, shift: US_SHIFTED_CHARACTERS.has(character) || (code >= 0x41 && code <= 0x5a)}
}

// Types text into the guest as keystrokes, for guests without a clipboard
// agent: installers, servers, Windows without guest tools
export async function typeIntoConsole(rfb: RFB, text: string, signal: AbortSignal) {
	const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
	for (const character of text.replace(/\r\n?/g, '\n')) {
		if (signal.aborted) return
		const key = keystroke(character)
		if (!key) continue
		if (key.shift) rfb.sendKey(XK_SHIFT_L, 'ShiftLeft', true)
		rfb.sendKey(key.keysym, null, true)
		await pause(KEY_HOLD_MS)
		rfb.sendKey(key.keysym, null, false)
		if (key.shift) rfb.sendKey(XK_SHIFT_L, 'ShiftLeft', false)
		await pause(KEY_INTERVAL_MS)
	}
}

// Writes text the guest copied to this computer's clipboard. The async
// Clipboard API only exists on secure origins, so over plain HTTP this falls
// back to a copy command, which browsers allow shortly after the keypress or
// click that caused the copy. Either way it fails without that activation.
export async function writeLocalClipboard(text: string) {
	try {
		if (navigator.clipboard) {
			await navigator.clipboard.writeText(text)
			return true
		}
	} catch {
		// Fall through to the copy command
	}
	const onCopy = (event: ClipboardEvent) => {
		event.clipboardData?.setData('text/plain', text)
		event.preventDefault()
	}
	document.addEventListener('copy', onCopy, true)
	try {
		return document.execCommand('copy')
	} catch {
		return false
	} finally {
		document.removeEventListener('copy', onCopy, true)
	}
}
