import {setTimeout as delay} from 'node:timers/promises'

import {execa} from 'execa'

import {
	createPointerMotion,
	pointOnMotion,
	type InputFeedback,
	type InputUpdate,
	type MachineInputActionType,
	type PointerMotion,
	type PointerTarget,
} from './input-motion.js'
export {MACHINE_INPUT_ACTIONS, easeTravel, type MachineInputActionType, type PointerTarget} from './input-motion.js'

import RfbClient, {
	POINTER_BUTTON_LEFT,
	POINTER_BUTTON_MIDDLE,
	POINTER_BUTTON_NONE,
	POINTER_BUTTON_RIGHT,
	POINTER_WHEEL_DOWN,
	POINTER_WHEEL_LEFT,
	POINTER_WHEEL_RIGHT,
	POINTER_WHEEL_UP,
	type Framebuffer,
} from './rfb-client.js'

// ─── Screenshots ─────────────────────────────────────────────────────────────

// Vision models downsample anything larger than this on their own, which
// silently breaks the mapping between the pixels a model saw and the
// coordinates it sends back. Scaling here keeps that mapping exact.
export const SCREENSHOT_MAX_EDGE = 1568
const SCREENSHOT_JPEG_QUALITY = 85
const SCREENSHOT_ENCODE_TIMEOUT_MS = 20_000

export type MachineScreenshot = {
	width: number
	height: number
	mimeType: 'image/jpeg'
	// Base64-encoded JPEG
	data: string
}

export function fitScreenshot(width: number, height: number) {
	const scale = Math.min(1, SCREENSHOT_MAX_EDGE / Math.max(width, height))
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
		scale,
	}
}

export async function encodeScreenshot(frame: Framebuffer): Promise<MachineScreenshot> {
	const fit = fitScreenshot(frame.width, frame.height)
	const ppm = Buffer.concat([Buffer.from(`P6\n${frame.width} ${frame.height}\n255\n`, 'latin1'), frame.rgb])
	// Full chroma keeps small coloured text legible, which is what an agent
	// reading a terminal or a dialog needs most from a screenshot
	const {stdout} = await execa(
		'convert',
		[
			'ppm:-',
			...(fit.scale < 1 ? ['-resize', `${fit.width}x${fit.height}!`] : []),
			'-quality',
			String(SCREENSHOT_JPEG_QUALITY),
			'-sampling-factor',
			'4:4:4',
			'jpeg:-',
		],
		{input: ppm, encoding: null, timeout: SCREENSHOT_ENCODE_TIMEOUT_MS, killSignal: 'SIGKILL'},
	)
	return {width: fit.width, height: fit.height, mimeType: 'image/jpeg', data: stdout.toString('base64')}
}

// ─── Keyboard ────────────────────────────────────────────────────────────────

// X11 keysyms, looked up case-insensitively by the X name plus the aliases
// agents commonly produce from xdotool-style key strings
const NAMED_KEYSYMS: Record<string, number> = {
	// Modifiers
	shift: 0xffe1,
	shift_l: 0xffe1,
	shift_r: 0xffe2,
	ctrl: 0xffe3,
	control: 0xffe3,
	control_l: 0xffe3,
	control_r: 0xffe4,
	alt: 0xffe9,
	alt_l: 0xffe9,
	alt_r: 0xffea,
	altgr: 0xfe03,
	iso_level3_shift: 0xfe03,
	meta: 0xffeb,
	meta_l: 0xffeb,
	super: 0xffeb,
	super_l: 0xffeb,
	super_r: 0xffec,
	win: 0xffeb,
	windows: 0xffeb,
	cmd: 0xffeb,
	command: 0xffeb,
	// Editing and navigation
	return: 0xff0d,
	enter: 0xff0d,
	kp_enter: 0xff8d,
	tab: 0xff09,
	iso_left_tab: 0xfe20,
	escape: 0xff1b,
	esc: 0xff1b,
	backspace: 0xff08,
	delete: 0xffff,
	del: 0xffff,
	insert: 0xff63,
	ins: 0xff63,
	home: 0xff50,
	end: 0xff57,
	page_up: 0xff55,
	pageup: 0xff55,
	prior: 0xff55,
	page_down: 0xff56,
	pagedown: 0xff56,
	next: 0xff56,
	left: 0xff51,
	up: 0xff52,
	right: 0xff53,
	down: 0xff54,
	space: 0x20,
	print: 0xff61,
	printscreen: 0xff61,
	sys_req: 0xff15,
	scroll_lock: 0xff14,
	pause: 0xff13,
	break: 0xff6b,
	caps_lock: 0xffe5,
	capslock: 0xffe5,
	num_lock: 0xff7f,
	numlock: 0xff7f,
	menu: 0xff67,
	// Keypad
	kp_0: 0xffb0,
	kp_1: 0xffb1,
	kp_2: 0xffb2,
	kp_3: 0xffb3,
	kp_4: 0xffb4,
	kp_5: 0xffb5,
	kp_6: 0xffb6,
	kp_7: 0xffb7,
	kp_8: 0xffb8,
	kp_9: 0xffb9,
	kp_add: 0xffab,
	kp_subtract: 0xffad,
	kp_multiply: 0xffaa,
	kp_divide: 0xffaf,
	kp_decimal: 0xffae,
	// Punctuation by X name
	plus: 0x2b,
	minus: 0x2d,
	equal: 0x3d,
	comma: 0x2c,
	period: 0x2e,
	slash: 0x2f,
	backslash: 0x5c,
	semicolon: 0x3b,
	apostrophe: 0x27,
	quotedbl: 0x22,
	grave: 0x60,
	asciitilde: 0x7e,
	bracketleft: 0x5b,
	bracketright: 0x5d,
	braceleft: 0x7b,
	braceright: 0x7d,
	bar: 0x7c,
	less: 0x3c,
	greater: 0x3e,
	question: 0x3f,
	exclam: 0x21,
	at: 0x40,
	numbersign: 0x23,
	dollar: 0x24,
	percent: 0x25,
	asciicircum: 0x5e,
	ampersand: 0x26,
	asterisk: 0x2a,
	parenleft: 0x28,
	parenright: 0x29,
	underscore: 0x5f,
	colon: 0x3a,
}
for (let index = 1; index <= 24; index++) NAMED_KEYSYMS[`f${index}`] = 0xffbe + index - 1

// Characters a US keyboard reaches through Shift. QEMU expects the client to
// press Shift itself, exactly as a person at the console would.
const US_SHIFTED_CHARACTERS = new Set('~!@#$%^&*()_+{}|:"<>?')
const SHIFT_KEYSYM = NAMED_KEYSYMS.shift!

export type Keystroke = {keysym: number; shift: boolean}

function keystrokeForCharacter(character: string): Keystroke {
	const code = character.codePointAt(0)!
	if (code >= 0x20 && code <= 0x7e) {
		return {keysym: code, shift: US_SHIFTED_CHARACTERS.has(character) || (code >= 0x41 && code <= 0x5a)}
	}
	if (code >= 0xa0 && code <= 0xff) return {keysym: code, shift: false}
	// Anything outside Latin-1 uses the Unicode keysym range. The guest keymap
	// decides whether it can be typed, the same as pasting into the console.
	return {keysym: 0x01000000 | code, shift: false}
}

export function textToKeystrokes(text: string): Keystroke[] {
	const keystrokes: Keystroke[] = []
	for (const character of text) {
		if (character === '\n') keystrokes.push({keysym: NAMED_KEYSYMS.return!, shift: false})
		else if (character === '\t') keystrokes.push({keysym: NAMED_KEYSYMS.tab!, shift: false})
		else if (character === '\r') continue
		else if (character.codePointAt(0)! < 0x20) throw new Error(`[machine-key-unknown] Cannot type control character`)
		else keystrokes.push(keystrokeForCharacter(character))
	}
	return keystrokes
}

function keystrokeForToken(token: string): Keystroke {
	if ([...token].length === 1) return keystrokeForCharacter(token)
	const keysym = NAMED_KEYSYMS[token.toLowerCase()]
	if (keysym === undefined) throw new Error(`[machine-key-unknown] Unknown key '${token}'`)
	// Named punctuation such as "plus" is the same key as the character
	return keysym < 0x100 ? keystrokeForCharacter(String.fromCodePoint(keysym)) : {keysym, shift: false}
}

// xdotool-style tokens: "ctrl+alt+Delete", "shift+Tab", "Return". A '+' that
// follows another '+' or ends the string is the plus key itself.
function tokenizeKeyCombination(text: string) {
	const tokens: string[] = []
	let current = ''
	for (let index = 0; index < text.length; index++) {
		const character = text[index]!
		if (character === '+' && current !== '') {
			tokens.push(current)
			current = ''
		} else {
			current += character
		}
	}
	if (current !== '') tokens.push(current)
	return tokens
}

export type KeyCombination = {held: number[]; key: Keystroke}

export function parseKeyCombination(text: string): KeyCombination {
	const tokens = tokenizeKeyCombination(text.trim())
	if (tokens.length === 0) throw new Error('[machine-key-unknown] No key given')
	const held = tokens.slice(0, -1).map((token) => keystrokeForToken(token).keysym)
	const key = keystrokeForToken(tokens.at(-1)!)
	// An explicit shift modifier already covers a shifted character
	if (key.shift && held.includes(SHIFT_KEYSYM)) key.shift = false
	return {held, key}
}

// Whitespace separates combinations pressed one after another
export function parseKeySequence(text: string) {
	const combinations = text.split(/\s+/).filter(Boolean)
	if (combinations.length === 0) throw new Error('[machine-key-unknown] No key given')
	return combinations.map(parseKeyCombination)
}

// ─── Input actions ───────────────────────────────────────────────────────────

export type PointerCoordinate = [number, number]
export type ScrollDirection = 'up' | 'down' | 'left' | 'right'

export type MachineInputAction = {
	action: MachineInputActionType
	// Pixels in the screenshot coordinate space, origin top-left
	coordinate?: PointerCoordinate
	startCoordinate?: PointerCoordinate
	text?: string
	scrollDirection?: ScrollDirection
	scrollAmount?: number
	duration?: number
}

export const MAX_TYPE_TEXT_LENGTH = 10_000
export const MAX_SCROLL_AMOUNT = 100
export const MAX_WAIT_SECONDS = 30
export const MIN_LONG_PRESS_SECONDS = 0.3
export const MAX_LONG_PRESS_SECONDS = 5

// Pacing that real keyboards and mice naturally provide and guests rely on:
// USB HID and PS/2 devices queue, but toolkits still debounce and
// double-click detection needs distinct presses
const KEY_HOLD_MS = 25
const KEY_INTERVAL_MS = 12
const CLICK_HOLD_MS = 60
const MULTI_CLICK_GAP_MS = 80
const DRAG_DURATION_MS = 300
// Window managers decide edge actions such as tiling only once the pointer
// has rested at the edge, so a drag pauses there before letting go
const DRAG_RELEASE_HOLD_MS = 300
const SCROLL_GAP_MS = 40
const POINTER_SETTLE_MS = 40
// Pointer travel is interpolated so a person watching the console sees the
// cursor move rather than teleport, and hover-sensitive interfaces see the
// pointer arrive the way a mouse would. Reports go out at a fixed cadence and
// the journey lasts longer the further it goes, within a range that still
// feels prompt.
const GLIDE_STEP_MS = 8

const POINTER_ACTIONS = new Set<MachineInputActionType>([
	'mouse_move',
	'left_click',
	'right_click',
	'middle_click',
	'double_click',
	'triple_click',
	'long_press',
	'left_click_drag',
	'scroll',
])
// The shade takes well over half a second to open and close; Escape sent
// sooner does nothing and the pull-down surfaces on the next press instead
const PRIME_SETTLE_MS = 1_500
const ESCAPE_KEYSYM = NAMED_KEYSYMS.escape!

const CLICK_BUTTONS = {
	left_click: POINTER_BUTTON_LEFT,
	right_click: POINTER_BUTTON_RIGHT,
	middle_click: POINTER_BUTTON_MIDDLE,
	double_click: POINTER_BUTTON_LEFT,
	triple_click: POINTER_BUTTON_LEFT,
} as const
const CLICK_COUNTS = {left_click: 1, right_click: 1, middle_click: 1, double_click: 2, triple_click: 3} as const
const SCROLL_BUTTONS = {
	up: POINTER_WHEEL_UP,
	down: POINTER_WHEEL_DOWN,
	left: POINTER_WHEEL_LEFT,
	right: POINTER_WHEEL_RIGHT,
} as const

export type InputOptions = {
	// Only machines with an absolute pointing device can be pointed at
	pointerSupported: boolean
	// Where the pointer was left by the previous action, in guest pixels, so
	// this one can travel from there
	pointer?: PointerTarget
	// Broadcast meaningful input phases and planned motion, without literal
	// text or a separate stream of per-frame pointer events.
	onUpdate?: (update: InputUpdate) => void
	// Confirmed positions stay local to the driver; only the planned journey
	// is broadcast. An interrupted move must resume from where it really got.
	onPosition?: (point: PointerTarget) => void
	// Spend the guest's first press after boot on nothing before the real
	// action. Android under Waydroid turns the first press after boot, wherever
	// it lands, into a pull-down of the notification shade; a throwaway press
	// in a far corner followed by Escape clears it, and the real action then
	// arrives after genuine pointer travel, which is what makes it land.
	primeFirstPress?: boolean
}

export type InputResult = {
	// Where the pointer is after the action, in guest pixels, when known
	pointer?: PointerTarget
	// Whether the throwaway first press was spent before this action
	primed?: boolean
}

function invalid(message: string): never {
	throw new Error(`[machine-input-invalid] ${message}`)
}

// Screenshot coordinates map back onto the guest framebuffer through the same
// fit the screenshot was made with, so what the agent saw is what it clicks
function guestPoint(client: RfbClient, coordinate: PointerCoordinate | undefined, name: string): PointerTarget {
	if (!coordinate) invalid(`${name} is required for this action`)
	const [x, y] = coordinate
	const fit = fitScreenshot(client.width, client.height)
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= fit.width || y >= fit.height) {
		throw new Error(
			`[machine-coordinate-out-of-bounds] ${name} [${x}, ${y}] is outside the ${fit.width}x${fit.height} screenshot`,
		)
	}
	return {
		x: Math.min(client.width - 1, Math.round(x / fit.scale)),
		y: Math.min(client.height - 1, Math.round(y / fit.scale)),
	}
}

async function pressKey(client: RfbClient, keystroke: Keystroke) {
	if (keystroke.shift) await client.keyEvent(SHIFT_KEYSYM, true)
	await client.keyEvent(keystroke.keysym, true)
	await delay(KEY_HOLD_MS)
	await client.keyEvent(keystroke.keysym, false)
	if (keystroke.shift) await client.keyEvent(SHIFT_KEYSYM, false)
}

async function withHeldKeys<T>(client: RfbClient, keysyms: number[], operation: () => Promise<T>) {
	for (const keysym of keysyms) await client.keyEvent(keysym, true)
	try {
		if (keysyms.length > 0) await delay(KEY_INTERVAL_MS)
		return await operation()
	} finally {
		for (const keysym of keysyms.toReversed()) await client.keyEvent(keysym, false)
	}
}

// Deadlines keep socket/host scheduling overhead out of the planned duration.
// Both the browser and guest sample the very same curve.
async function followMotion(
	client: RfbClient,
	motion: PointerMotion,
	buttonMask: number,
	onPosition?: (point: PointerTarget) => void,
) {
	const started = performance.now()
	let previous = motion.from
	let elapsed = 0
	while (elapsed < motion.durationMs) {
		await delay(Math.min(GLIDE_STEP_MS, motion.durationMs - elapsed))
		elapsed = performance.now() - started
		const sampled = pointOnMotion(motion, elapsed / motion.durationMs)
		const point = {x: Math.round(sampled.x), y: Math.round(sampled.y)}
		if (point.x !== previous.x || point.y !== previous.y) {
			await client.pointerEvent(point.x, point.y, buttonMask)
			onPosition?.(point)
		}
		previous = point
	}
}

// Moves the pointer from where it was to the target in evenly timed, eased
// steps, keeping any button mask held throughout. Without a known start there
// is nothing to travel from, so the pointer simply appears at the target. A
// target the pointer is already resting on gets a one-pixel nudge first:
// Android's pointer-to-touch bridge places a press from the most recent
// motion, and a press with no motion since the previous press lands wrong.
async function glide(
	client: RfbClient,
	from: PointerTarget | undefined,
	to: PointerTarget,
	buttonMask: number,
	onTravel: (target: PointerTarget, motion?: PointerMotion) => void,
	onPosition?: (point: PointerTarget) => void,
) {
	if (!from) {
		await client.pointerEvent(to.x, to.y, buttonMask)
		onPosition?.(to)
		onTravel(to)
		return
	}
	if (from.x === to.x && from.y === to.y) {
		await client.pointerEvent(to.x > 0 ? to.x - 1 : to.x + 1, to.y, buttonMask)
		await delay(GLIDE_STEP_MS)
		await client.pointerEvent(to.x, to.y, buttonMask)
		onPosition?.(to)
		onTravel(to)
		return
	}
	const motion = createPointerMotion(from, to, {width: client.width, height: client.height})
	onTravel(to, motion)
	await followMotion(client, motion, buttonMask, onPosition)
}

async function click(
	client: RfbClient,
	target: PointerTarget,
	button: number,
	count: number,
	onPhase: (phase: 'pressed' | 'released') => void,
) {
	await delay(POINTER_SETTLE_MS)
	for (let index = 0; index < count; index++) {
		if (index > 0) await delay(MULTI_CLICK_GAP_MS)
		await client.pointerEvent(target.x, target.y, button)
		onPhase('pressed')
		try {
			await delay(CLICK_HOLD_MS)
		} finally {
			await client.pointerEvent(target.x, target.y, POINTER_BUTTON_NONE)
			onPhase('released')
		}
	}
}

// The throwaway press goes to the screen corner farthest from the target,
// where nothing sits, so the real action always travels there from somewhere
// else
async function primeFirstPress(client: RfbClient, target: PointerTarget) {
	const corner = {
		x: target.x < client.width / 2 ? client.width - 1 : 0,
		y: target.y < client.height / 2 ? client.height - 1 : 0,
	}
	await client.pointerEvent(corner.x, corner.y, POINTER_BUTTON_NONE)
	await delay(POINTER_SETTLE_MS)
	await client.pointerEvent(corner.x, corner.y, POINTER_BUTTON_LEFT)
	await delay(CLICK_HOLD_MS)
	await client.pointerEvent(corner.x, corner.y, POINTER_BUTTON_NONE)
	await delay(PRIME_SETTLE_MS)
	await pressKey(client, {keysym: ESCAPE_KEYSYM, shift: false})
	await delay(PRIME_SETTLE_MS)
	return corner
}

function heldKeysFor(text: string | undefined) {
	if (!text?.trim()) return []
	return tokenizeKeyCombination(text.trim()).map((token) => keystrokeForToken(token).keysym)
}

export async function performInputAction(
	client: RfbClient,
	action: MachineInputAction,
	options: InputOptions,
): Promise<InputResult> {
	const pointer = (coordinate: PointerCoordinate | undefined, name = 'coordinate') => {
		if (!options.pointerSupported) {
			throw new Error(
				'[machine-pointer-unsupported] This machine has no absolute pointing device, so only keyboard actions are available',
			)
		}
		return guestPoint(client, coordinate, name)
	}
	let from = options.pointer
	const report = (
		phase: InputFeedback['phase'],
		details: Partial<InputFeedback> = {},
		point = from,
		motion?: PointerMotion,
	) => {
		options.onUpdate?.({feedback: {action: action.action, phase, ...details}, pointer: point, motion})
	}
	const travel = async (to: PointerTarget) => {
		await glide(
			client,
			from,
			to,
			POINTER_BUTTON_NONE,
			(point, motion) => report('moving', {}, point, motion),
			options.onPosition,
		)
		from = to
	}

	// Only a press trips the guest's first-press quirk, so only pointer actions
	// prime. A typing move never presses and leaves the quirk armed.
	const primed = options.primeFirstPress === true && POINTER_ACTIONS.has(action.action)
	if (primed) from = await primeFirstPress(client, pointer(action.startCoordinate ?? action.coordinate))
	const result = (target: PointerTarget | undefined): InputResult =>
		primed ? {pointer: target, primed} : {pointer: target}

	switch (action.action) {
		case 'mouse_move': {
			const target = pointer(action.coordinate)
			await travel(target)
			report('complete')
			return result(target)
		}
		case 'left_click':
		case 'right_click':
		case 'middle_click':
		case 'double_click':
		case 'triple_click': {
			const target = pointer(action.coordinate)
			const {action: clickAction} = action
			await travel(target)
			await withHeldKeys(client, heldKeysFor(action.text), () =>
				click(client, target, CLICK_BUTTONS[clickAction], CLICK_COUNTS[clickAction], (phase) => report(phase)),
			)
			return result(target)
		}
		case 'long_press': {
			const target = pointer(action.coordinate)
			const seconds = action.duration ?? 1
			if (!(seconds >= MIN_LONG_PRESS_SECONDS && seconds <= MAX_LONG_PRESS_SECONDS)) {
				invalid(`duration must be between ${MIN_LONG_PRESS_SECONDS} and ${MAX_LONG_PRESS_SECONDS}`)
			}
			await travel(target)
			await delay(POINTER_SETTLE_MS)
			await client.pointerEvent(target.x, target.y, POINTER_BUTTON_LEFT)
			report('pressed', {durationMs: seconds * 1_000})
			try {
				await delay(seconds * 1_000)
			} finally {
				await client.pointerEvent(target.x, target.y, POINTER_BUTTON_NONE)
				report('released')
			}
			return result(target)
		}
		case 'left_click_drag': {
			const start = pointer(action.startCoordinate, 'startCoordinate')
			const end = pointer(action.coordinate)
			await travel(start)
			await delay(POINTER_SETTLE_MS)
			await client.pointerEvent(start.x, start.y, POINTER_BUTTON_LEFT)
			report('pressed')
			let releasedAt = start
			try {
				await delay(CLICK_HOLD_MS)
				// Selection, sliders and window drags must follow a direct path.
				const motion = createPointerMotion(start, end, {
					width: client.width,
					height: client.height,
					straight: true,
					durationMs: DRAG_DURATION_MS,
				})
				report('pressed', {}, end, motion)
				await followMotion(client, motion, POINTER_BUTTON_LEFT, (point) => {
					releasedAt = point
					options.onPosition?.(point)
				})
				releasedAt = end
				await delay(DRAG_RELEASE_HOLD_MS)
			} finally {
				await client.pointerEvent(releasedAt.x, releasedAt.y, POINTER_BUTTON_NONE)
				report('released', {}, releasedAt)
			}
			return result(end)
		}
		case 'scroll': {
			const target = pointer(action.coordinate)
			if (!action.scrollDirection) invalid('scrollDirection is required for scroll')
			const amount = action.scrollAmount ?? 3
			if (!Number.isInteger(amount) || amount < 1 || amount > MAX_SCROLL_AMOUNT) {
				invalid(`scrollAmount must be between 1 and ${MAX_SCROLL_AMOUNT}`)
			}
			const button = SCROLL_BUTTONS[action.scrollDirection]
			await travel(target)
			await delay(POINTER_SETTLE_MS)
			await withHeldKeys(client, heldKeysFor(action.text), async () => {
				for (let index = 0; index < amount; index++) {
					if (index > 0) await delay(SCROLL_GAP_MS)
					await client.pointerEvent(target.x, target.y, button)
					await client.pointerEvent(target.x, target.y, POINTER_BUTTON_NONE)
					if (index === 0) report('active', {direction: action.scrollDirection})
				}
			})
			report('complete', {direction: action.scrollDirection})
			return result(target)
		}
		case 'key': {
			if (!action.text) invalid('text is required for key')
			const combinations = parseKeySequence(action.text)
			report('active')
			for (const [index, combination] of combinations.entries()) {
				if (index > 0) await delay(KEY_HOLD_MS)
				await withHeldKeys(client, combination.held, () => pressKey(client, combination.key))
			}
			report('complete')
			return {pointer: options.pointer}
		}
		case 'type': {
			if (action.text === undefined || action.text === '') invalid('text is required for type')
			if (action.text.length > MAX_TYPE_TEXT_LENGTH) invalid(`text is limited to ${MAX_TYPE_TEXT_LENGTH} characters`)
			const keystrokes = textToKeystrokes(action.text)
			// The host cannot see which field has focus; only the agent, looking at
			// the screenshot, can. So typing must say where the text goes, and the
			// pointer travels there first without clicking or disturbing focus.
			if (options.pointerSupported && !action.coordinate) {
				invalid('coordinate is required for type: the position of the field the text goes into')
			}
			if (action.coordinate) await travel(pointer(action.coordinate))
			report('active')
			for (const [index, keystroke] of keystrokes.entries()) {
				if (index > 0) await delay(KEY_INTERVAL_MS)
				await pressKey(client, keystroke)
			}
			report('complete')
			return {pointer: from}
		}
		case 'wait': {
			const seconds = action.duration ?? 1
			if (!(seconds >= 0 && seconds <= MAX_WAIT_SECONDS)) invalid(`duration must be between 0 and ${MAX_WAIT_SECONDS}`)
			// Clear previous feedback and establish ownership without a waiting animation.
			report('complete')
			await delay(seconds * 1_000)
			return {pointer: options.pointer}
		}
		default:
			invalid(`Unknown action '${String(action.action)}'`)
	}
}
