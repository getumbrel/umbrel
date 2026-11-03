import {inertia, type Camera} from './camera'
import type {Guest} from './guest'
import {charKeysym, XK} from './keysyms'

export type Modifier = 'shift' | 'ctrl' | 'alt'
export type ModifierState = 'off' | 'latched' | 'locked'

const MODIFIER_KEYSYMS: Record<Modifier, number> = {shift: XK.Shift, ctrl: XK.Control, alt: XK.Alt}
const MODIFIERS = Object.keys(MODIFIER_KEYSYMS) as Modifier[]
const DOUBLE_TAP_MS = 340
const KEY_HOLD_MS = 25
const KEY_INTERVAL_MS = 12
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const LEFT = 1
export const MIDDLE = 2
export const RIGHT = 4

// Everything the touch surfaces and keys say to the guest goes through here
export class Controller {
	x: number
	y: number
	private buttons = 0
	modifiers: Record<Modifier, ModifierState> = {shift: 'off', ctrl: 'off', alt: 'off'}
	private modifierTappedAt: Record<Modifier, number> = {shift: 0, ctrl: 0, alt: 0}
	private pressedForKey: Modifier[] = []
	private listeners = new Set<() => void>()
	private version = 0
	private stopInertia: (() => void) | undefined
	onType?: () => void

	constructor(
		public guest: Guest,
		public camera: Camera,
	) {
		this.x = guest.x
		this.y = guest.y
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => void this.listeners.delete(listener)
	}
	getVersion = () => this.version
	private changed() {
		this.version++
		for (const listener of this.listeners) listener()
	}

	private send() {
		this.guest.pointer(this.x, this.y, this.buttons)
	}

	moveToGuest(x: number, y: number) {
		this.x = Math.max(0, Math.min(this.guest.width - 1, x))
		this.y = Math.max(0, Math.min(this.guest.height - 1, y))
		this.send()
	}

	moveToStage(px: number, py: number) {
		const {x, y} = this.camera.toGuest(px, py)
		this.moveToGuest(x, y)
	}

	// Relative movement, from a trackpad. Stage pixels, so speed feels the same
	// at any zoom; the view follows the pointer once it nears an edge.
	moveBy(dx: number, dy: number) {
		const {s} = this.camera
		this.moveToGuest(this.x + dx / s, this.y + dy / s)
		this.camera.follow(this.x, this.y)
	}

	down(mask: number) {
		this.beginKeyModifiers()
		this.buttons |= mask
		this.send()
	}

	up(mask: number) {
		this.buttons &= ~mask
		this.send()
		this.endKeyModifiers()
	}

	click(mask: number) {
		this.down(mask)
		this.up(mask)
		// Menus open right of and below the pointer, so leave them room
		if (mask === RIGHT) this.camera.makeRoom(this.x, this.y)
	}

	// Finger travel in stage pixels. Content follows the finger, so moving down
	// scrolls up, at whatever zoom the screen is at.
	scroll(dx: number, dy: number) {
		const {s} = this.camera
		this.guest.wheel(this.x, this.y, -dx / s, -dy / s)
	}

	// One finger: the view moves first, and what it can't take scrolls the guest
	panOrScroll(dx: number, dy: number) {
		const rest = this.camera.panBy(dx, dy)
		if (rest.x || rest.y) this.scroll(rest.x, rest.y)
	}

	flick(vx: number, vy: number, kind: 'pan' | 'scroll') {
		this.haltFlick()
		const step = kind === 'pan' ? this.panOrScroll.bind(this) : this.scroll.bind(this)
		if (Math.hypot(vx, vy) > 60) this.stopInertia = inertia(vx, vy, step)
	}

	haltFlick() {
		this.stopInertia?.()
		this.stopInertia = undefined
	}

	// Sticks like Shift on a phone: one tap for the next key, a quick second tap
	// to keep it down until it's tapped off
	tapModifier(modifier: Modifier) {
		const now = performance.now()
		const state = this.modifiers[modifier]
		const quick = now - this.modifierTappedAt[modifier] < DOUBLE_TAP_MS
		this.modifierTappedAt[modifier] = now
		const keysym = MODIFIER_KEYSYMS[modifier]
		if (state === 'off') this.modifiers[modifier] = 'latched'
		else if (state === 'latched' && quick) {
			this.modifiers[modifier] = 'locked'
			this.guest.key(keysym, true)
		} else {
			if (state === 'locked') this.guest.key(keysym, false)
			this.modifiers[modifier] = 'off'
		}
		this.changed()
	}

	// Latched modifiers only reach the guest around the key they modify. Sent any
	// earlier, a lone Alt would open a Windows menu bar.
	private beginKeyModifiers() {
		this.pressedForKey = MODIFIERS.filter((modifier) => this.modifiers[modifier] === 'latched')
		for (const modifier of this.pressedForKey) this.guest.key(MODIFIER_KEYSYMS[modifier], true)
	}

	private endKeyModifiers() {
		if (!this.pressedForKey.length) return
		for (const modifier of this.pressedForKey) {
			this.guest.key(MODIFIER_KEYSYMS[modifier], false)
			this.modifiers[modifier] = 'off'
		}
		this.pressedForKey = []
		this.changed()
	}

	private pressKey(keysym: number) {
		this.beginKeyModifiers()
		this.guest.key(keysym, true)
	}

	private releaseKey(keysym: number) {
		this.guest.key(keysym, false)
		this.endKeyModifiers()
		this.onType?.()
	}

	// One line for everything typed, so an arrow can't overtake the letters before it
	private typing = Promise.resolve()
	private enqueue(task: () => void, wait: number) {
		this.typing = this.typing.then(() => {
			task()
			return pause(wait)
		})
	}

	keyDown(keysym: number) {
		if (this.guest.paced) this.enqueue(() => this.pressKey(keysym), 0)
		else this.pressKey(keysym)
	}

	keyUp(keysym: number) {
		if (this.guest.paced) this.enqueue(() => this.releaseKey(keysym), KEY_INTERVAL_MS)
		else this.releaseKey(keysym)
	}

	chord(...keysyms: number[]) {
		for (const keysym of keysyms) this.guest.key(keysym, true)
		for (const keysym of [...keysyms].reverse()) this.guest.key(keysym, false)
		this.onType?.()
	}

	// The same pacing the real console types pastes with: toolkits debounce, so a
	// keystroke needs a real press and a gap after it
	tapKey(keysym: number) {
		if (this.guest.paced) {
			this.enqueue(() => this.pressKey(keysym), KEY_HOLD_MS)
			this.enqueue(() => this.releaseKey(keysym), KEY_INTERVAL_MS)
		} else {
			this.pressKey(keysym)
			this.releaseKey(keysym)
		}
	}

	typeText(text: string) {
		const normalized = text.replace(/\r\n?/g, '\n')
		// QEMU drops what its US keymap has no key for, so that takes the clipboard
		if (this.guest.paste && /[^\n\t\x20-\x7e]/.test(normalized)) {
			this.guest.paste(normalized)
			return
		}
		for (const character of normalized) {
			this.tapKey(character === '\n' ? XK.Return : character === '\t' ? XK.Tab : charKeysym(character))
		}
	}
}
