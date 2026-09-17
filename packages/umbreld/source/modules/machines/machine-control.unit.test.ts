import {expect, test} from 'vitest'

import {
	easeTravel,
	fitScreenshot,
	parseKeyCombination,
	parseKeySequence,
	performInputAction,
	SCREENSHOT_MAX_EDGE,
	textToKeystrokes,
	type MachineInputAction,
} from './machine-control.js'
import {pointOnMotion, type InputUpdate} from './input-motion.js'
import type RfbClient from './rfb-client.js'

const SHIFT = 0xffe1
const CONTROL = 0xffe3
const ALT = 0xffe9
const SUPER = 0xffeb
const RETURN = 0xff0d
const DELETE = 0xffff
const TAB = 0xff09

type Event = ['key', number, boolean] | ['pointer', number, number, number]

function fakeClient(width: number, height: number) {
	const events: Event[] = []
	const client = {
		width,
		height,
		async keyEvent(keysym: number, down: boolean) {
			events.push(['key', keysym, down])
		},
		async pointerEvent(x: number, y: number, buttonMask: number) {
			events.push(['pointer', x, y, buttonMask])
		},
	} as unknown as RfbClient
	return {client, events}
}

function control(client: RfbClient, action: MachineInputAction, pointerSupported = true) {
	return performInputAction(client, action, {pointerSupported})
}

function pointerEvents(events: Event[]) {
	return events.filter((event) => event[0] === 'pointer')
}

test('screenshots keep their aspect ratio under the vision-model edge limit', () => {
	expect(fitScreenshot(1024, 768)).toStrictEqual({width: 1024, height: 768, scale: 1})
	expect(fitScreenshot(1920, 1080)).toMatchObject({width: SCREENSHOT_MAX_EDGE, height: 882})
	expect(fitScreenshot(1080, 1920)).toMatchObject({width: 882, height: SCREENSHOT_MAX_EDGE})
	expect(fitScreenshot(3840, 2160).scale).toBeCloseTo(SCREENSHOT_MAX_EDGE / 3840)
})

test('key combinations follow xdotool conventions and synthesize Shift like a real keyboard', () => {
	expect(parseKeyCombination('ctrl+alt+Delete')).toStrictEqual({
		held: [CONTROL, ALT],
		key: {keysym: DELETE, shift: false},
	})
	expect(parseKeyCombination('RETURN')).toStrictEqual({held: [], key: {keysym: RETURN, shift: false}})
	expect(parseKeyCombination('enter')).toStrictEqual({held: [], key: {keysym: RETURN, shift: false}})
	expect(parseKeyCombination('super')).toStrictEqual({held: [], key: {keysym: SUPER, shift: false}})
	expect(parseKeyCombination('cmd+space')).toStrictEqual({held: [SUPER], key: {keysym: 0x20, shift: false}})
	expect(parseKeyCombination('ctrl+c')).toStrictEqual({held: [CONTROL], key: {keysym: 0x63, shift: false}})
	// Uppercase and symbols need Shift on a US layout unless it is already held
	expect(parseKeyCombination('ctrl+A')).toStrictEqual({held: [CONTROL], key: {keysym: 0x41, shift: true}})
	expect(parseKeyCombination('ctrl+shift+A')).toStrictEqual({held: [CONTROL, SHIFT], key: {keysym: 0x41, shift: false}})
	expect(parseKeyCombination('!')).toStrictEqual({held: [], key: {keysym: 0x21, shift: true}})
	expect(parseKeyCombination('F12')).toStrictEqual({held: [], key: {keysym: 0xffc9, shift: false}})
	// A trailing or doubled plus is the plus key itself
	expect(parseKeyCombination('ctrl++')).toStrictEqual({held: [CONTROL], key: {keysym: 0x2b, shift: true}})
	expect(parseKeyCombination('plus')).toStrictEqual({held: [], key: {keysym: 0x2b, shift: true}})
	expect(() => parseKeyCombination('ctrl+Bogus')).toThrow('[machine-key-unknown]')
	expect(() => parseKeyCombination('')).toThrow('[machine-key-unknown]')
	expect(parseKeySequence('ctrl+l  Return')).toHaveLength(2)
})

test('typed text becomes keystrokes with Shift, Return, and Tab handled', () => {
	expect(textToKeystrokes('Hi!\n\tq')).toStrictEqual([
		{keysym: 0x48, shift: true},
		{keysym: 0x69, shift: false},
		{keysym: 0x21, shift: true},
		{keysym: RETURN, shift: false},
		{keysym: TAB, shift: false},
		{keysym: 0x71, shift: false},
	])
	expect(textToKeystrokes('é€')).toStrictEqual([
		{keysym: 0xe9, shift: false},
		{keysym: 0x01000000 | 0x20ac, shift: false},
	])
	expect(() => textToKeystrokes('\u0001')).toThrow('[machine-key-unknown]')
})

test('clicks map screenshot coordinates back onto the guest framebuffer', async () => {
	const {client, events} = fakeClient(1920, 1080)
	const fit = fitScreenshot(1920, 1080)
	await control(client, {action: 'left_click', coordinate: [fit.width - 1, fit.height - 1]})
	expect(events).toStrictEqual([
		['pointer', 1919, 1079, 0],
		['pointer', 1919, 1079, 1],
		['pointer', 1919, 1079, 0],
	])

	events.length = 0
	await control(client, {action: 'right_click', coordinate: [784, 441], text: 'shift'})
	// The pointer travels first, then the modifier is held around the press
	expect(events).toStrictEqual([
		['pointer', 960, 540, 0],
		['key', SHIFT, true],
		['pointer', 960, 540, 4],
		['pointer', 960, 540, 0],
		['key', SHIFT, false],
	])

	events.length = 0
	await control(client, {action: 'double_click', coordinate: [0, 0]})
	expect(events.filter((event) => event[0] === 'pointer' && event[3] === 1)).toHaveLength(2)

	await expect(control(client, {action: 'left_click', coordinate: [fit.width, 0]})).rejects.toThrow(
		'[machine-coordinate-out-of-bounds]',
	)
	await expect(control(client, {action: 'left_click'})).rejects.toThrow('[machine-input-invalid]')
	await expect(control(client, {action: 'left_click', coordinate: [1, 1]}, false)).rejects.toThrow(
		'[machine-pointer-unsupported]',
	)
})

test('drags travel while pressed and scrolls pulse the wheel the requested number of times', async () => {
	const {client, events} = fakeClient(800, 600)
	await control(client, {action: 'left_click_drag', startCoordinate: [0, 0], coordinate: [120, 60]})
	expect(events[0]).toStrictEqual(['pointer', 0, 0, 0])
	expect(events[1]).toStrictEqual(['pointer', 0, 0, 1])
	const pressedMoves = events.slice(2, -1)
	expect(pressedMoves.length).toBeGreaterThan(5)
	expect(pressedMoves.every((event) => event[0] === 'pointer' && event[3] === 1)).toBe(true)
	expect(events.at(-1)).toStrictEqual(['pointer', 120, 60, 0])

	events.length = 0
	await control(client, {action: 'scroll', coordinate: [10, 10], scrollDirection: 'down', scrollAmount: 2})
	expect(events).toStrictEqual([
		['pointer', 10, 10, 0],
		['pointer', 10, 10, 16],
		['pointer', 10, 10, 0],
		['pointer', 10, 10, 16],
		['pointer', 10, 10, 0],
	])
	await expect(control(client, {action: 'scroll', coordinate: [10, 10]})).rejects.toThrow('scrollDirection')
})

test('key and type actions press modifiers around keys and pace keystrokes', async () => {
	const {client, events} = fakeClient(800, 600)
	await control(client, {action: 'key', text: 'ctrl+alt+Delete'})
	expect(events).toStrictEqual([
		['key', CONTROL, true],
		['key', ALT, true],
		['key', DELETE, true],
		['key', DELETE, false],
		['key', ALT, false],
		['key', CONTROL, false],
	])

	events.length = 0
	await control(client, {action: 'type', text: 'A\n', coordinate: [10, 10]})
	expect(events.filter((event) => event[0] === 'key')).toStrictEqual([
		['key', SHIFT, true],
		['key', 0x41, true],
		['key', 0x41, false],
		['key', SHIFT, false],
		['key', RETURN, true],
		['key', RETURN, false],
	])
	await expect(control(client, {action: 'type', text: '', coordinate: [10, 10]})).rejects.toThrow(
		'[machine-input-invalid]',
	)
	await expect(control(client, {action: 'key'})).rejects.toThrow('[machine-input-invalid]')
	await expect(control(client, {action: 'wait', duration: 999})).rejects.toThrow('[machine-input-invalid]')
})

test('the pointer glides from where the previous action left it and every pointer action reports where it ended', async () => {
	const {client, events} = fakeClient(800, 600)
	const travels: Array<[{x: number; y: number}, number]> = []
	await expect(
		performInputAction(
			client,
			{action: 'mouse_move', coordinate: [400, 0]},
			{
				pointerSupported: true,
				pointer: {x: 0, y: 0},
				onUpdate: ({pointer, motion}) => {
					if (pointer && motion) travels.push([pointer, motion.durationMs])
				},
			},
		),
	).resolves.toStrictEqual({pointer: {x: 400, y: 0}})
	const moves = pointerEvents(events)
	// The journey is sampled against elapsed time so scheduling
	// delays cannot accumulate. It ends on the exact target.
	expect(moves.length).toBeGreaterThan(5)
	expect(moves.length).toBeLessThanOrEqual(100)
	const xs = moves.map((event) => event[1] as number)
	expect(xs.at(-1)).toBe(400)
	const strides = xs.map((x, index) => x - (index === 0 ? 0 : xs[index - 1]!))
	const middle = Math.max(...strides)
	expect(strides[0]).toBeLessThan(middle)
	expect(strides.at(-1)).toBeLessThan(middle)
	expect(moves.every((event) => event[3] === 0)).toBe(true)
	// The journey is announced once, as it starts, with its duration
	expect(travels).toHaveLength(1)
	expect(travels[0]![0]).toEqual({x: 400, y: 0})
	expect(travels[0]![1]).toBeGreaterThanOrEqual(120)
	expect(travels[0]![1]).toBeLessThanOrEqual(720)
	expect(easeTravel(0)).toBe(0)
	expect(easeTravel(1)).toBe(1)
	expect(easeTravel(0.5)).toBeGreaterThan(0.5)
	for (let i = 1; i <= 100; i++) expect(easeTravel(i / 100)).toBeGreaterThan(easeTravel((i - 1) / 100))
	expect(easeTravel(0.25)).toBeLessThan(0.25)
	expect(easeTravel(0.75)).toBeGreaterThan(0.75)

	// Without a known start the pointer simply appears at the target
	events.length = 0
	await expect(control(client, {action: 'mouse_move', coordinate: [10, 10]})).resolves.toStrictEqual({
		pointer: {x: 10, y: 10},
	})
	expect(events).toStrictEqual([['pointer', 10, 10, 0]])

	// Keyboard actions leave the pointer where it was
	await expect(
		performInputAction(client, {action: 'key', text: 'Return'}, {pointerSupported: true, pointer: {x: 5, y: 6}}),
	).resolves.toStrictEqual({pointer: {x: 5, y: 6}})
})

test('long presses hold the button for the requested time', async () => {
	const {client, events} = fakeClient(800, 600)
	const started = Date.now()
	await expect(control(client, {action: 'long_press', coordinate: [30, 40], duration: 0.4})).resolves.toStrictEqual({
		pointer: {x: 30, y: 40},
	})
	expect(Date.now() - started).toBeGreaterThanOrEqual(400)
	expect(events).toStrictEqual([
		['pointer', 30, 40, 0],
		['pointer', 30, 40, 1],
		['pointer', 30, 40, 0],
	])
	await expect(control(client, {action: 'long_press', coordinate: [30, 40], duration: 0.1})).rejects.toThrow(
		'[machine-input-invalid]',
	)
	await expect(control(client, {action: 'long_press', coordinate: [30, 40], duration: 9})).rejects.toThrow(
		'[machine-input-invalid]',
	)
})

test('drags rest at their destination before releasing so edge actions register', async () => {
	const {client, events} = fakeClient(800, 600)
	const started = Date.now()
	await control(client, {action: 'left_click_drag', startCoordinate: [0, 0], coordinate: [100, 0]})
	// Twelve pressed steps at 25 ms plus a 300 ms rest before the release
	expect(Date.now() - started).toBeGreaterThanOrEqual(12 * 25 + 300)
	expect(events.at(-1)).toStrictEqual(['pointer', 100, 0, 0])
	expect(events.at(-2)).toStrictEqual(['pointer', 100, 0, 1])
})

test('priming spends the first press in the far corner, then travels to the real target', async () => {
	const {client, events} = fakeClient(800, 600)
	await performInputAction(
		client,
		{action: 'left_click', coordinate: [100, 100]},
		{pointerSupported: true, primeFirstPress: true},
	)
	// A target in the top-left quadrant is primed from the bottom-right corner
	expect(events.slice(0, 5)).toStrictEqual([
		['pointer', 799, 599, 0],
		['pointer', 799, 599, 1],
		['pointer', 799, 599, 0],
		['key', 0xff1b, true],
		['key', 0xff1b, false],
	])
	const travel = pointerEvents(events.slice(5, -2))
	expect(travel.length).toBeGreaterThan(1)
	expect(travel.at(-1)).toStrictEqual(['pointer', 100, 100, 0])
	expect(events.slice(-2)).toStrictEqual([
		['pointer', 100, 100, 1],
		['pointer', 100, 100, 0],
	])

	// Keyboard actions never need priming
	events.length = 0
	await performInputAction(client, {action: 'key', text: 'Return'}, {pointerSupported: true, primeFirstPress: true})
	expect(events).toStrictEqual([
		['key', 0xff0d, true],
		['key', 0xff0d, false],
	])
})

test('only a press spends the prime: a typing move reports the guest still unprimed', async () => {
	const {client, events} = fakeClient(800, 600)
	const typed = await performInputAction(
		client,
		{action: 'type', text: 'a', coordinate: [100, 100]},
		{pointerSupported: true, primeFirstPress: true},
	)
	expect(typed.primed).toBeUndefined()
	expect(pointerEvents(events)).toStrictEqual([['pointer', 100, 100, 0]])
	const clicked = await performInputAction(
		client,
		{action: 'left_click', coordinate: [100, 100]},
		{pointerSupported: true, primeFirstPress: true, pointer: typed.pointer},
	)
	expect(clicked.primed).toBe(true)
	const keyboardOnly = await performInputAction(
		client,
		{action: 'key', text: 'Return'},
		{pointerSupported: true, primeFirstPress: true},
	)
	expect(keyboardOnly.primed).toBeUndefined()
})

test('a press aimed at the resting pointer nudges it first so the guest sees motion', async () => {
	const {client, events} = fakeClient(800, 600)
	await performInputAction(
		client,
		{action: 'left_click', coordinate: [50, 60]},
		{pointerSupported: true, pointer: {x: 50, y: 60}},
	)
	expect(events).toStrictEqual([
		['pointer', 49, 60, 0],
		['pointer', 50, 60, 0],
		['pointer', 50, 60, 1],
		['pointer', 50, 60, 0],
	])
})

test('feedback follows the actual double-click presses and releases', async () => {
	const {client, events} = fakeClient(800, 600)
	const updates: Array<{update: InputUpdate; lastEvent: Event | undefined}> = []
	await performInputAction(
		client,
		{action: 'double_click', coordinate: [500, 300]},
		{
			pointerSupported: true,
			pointer: {x: 100, y: 100},
			onUpdate: (update) => updates.push({update, lastEvent: events.at(-1)}),
		},
	)
	expect(updates.map(({update}) => update.feedback.phase)).toEqual([
		'moving',
		'pressed',
		'released',
		'pressed',
		'released',
	])
	for (const {update, lastEvent} of updates.slice(1)) {
		expect(lastEvent).toEqual(['pointer', 500, 300, update.feedback.phase === 'pressed' ? 1 : 0])
		expect(update.motion).toBeUndefined()
	}
})

test('typing and shortcut names never enter feedback', async () => {
	const {client} = fakeClient(800, 600)
	const updates: InputUpdate[] = []
	const options = {pointerSupported: true, onUpdate: (update: InputUpdate) => updates.push(update)}
	await performInputAction(client, {action: 'type', text: 's3cret!', coordinate: [40, 40]}, options)
	expect(updates.map(({feedback}) => feedback)).toEqual([
		{action: 'type', phase: 'moving'},
		{action: 'type', phase: 'active'},
		{action: 'type', phase: 'complete'},
	])
	updates.length = 0
	await performInputAction(client, {action: 'key', text: 's shift+E ctrl+l Return'}, options)
	expect(updates.map(({feedback}) => feedback)).toEqual([
		{action: 'key', phase: 'active'},
		{action: 'key', phase: 'complete'},
	])
	expect(JSON.stringify(updates)).not.toContain('s3cret')
})

test('held drags stay direct and release the mouse even when moving fails', async () => {
	const {client, events} = fakeClient(800, 600)
	const updates: InputUpdate[] = []
	await performInputAction(
		client,
		{action: 'left_click_drag', startCoordinate: [30, 100], coordinate: [730, 100]},
		{
			pointerSupported: true,
			onUpdate: (update) => updates.push(update),
		},
	)
	const heldMotion = updates.find(({motion}) => motion)!
	expect(heldMotion.feedback.phase).toBe('pressed')
	expect(pointOnMotion(heldMotion.motion!, 0.5)).toEqual({x: 30 + 700 * easeTravel(0.5), y: 100})
	expect(updates.at(-1)?.feedback.phase).toBe('released')
	let failed = false
	const original = client.pointerEvent.bind(client)
	client.pointerEvent = async (x, y, button) => {
		if (button === 1 && x > 30 && !failed) {
			failed = true
			throw new Error('display interrupted')
		}
		return original(x, y, button)
	}
	await expect(
		performInputAction(
			client,
			{action: 'left_click_drag', startCoordinate: [30, 100], coordinate: [730, 100]},
			{pointerSupported: true},
		),
	).rejects.toThrow('display interrupted')
	expect(events.at(-1)?.[3]).toBe(0)
})

test('an interrupted journey remembers its last confirmed position instead of its intended destination', async () => {
	const {client, events} = fakeClient(800, 600)
	const send = client.pointerEvent.bind(client)
	client.pointerEvent = async (x, y, mask) => {
		if (x > 300) throw new Error('display closed')
		return send(x, y, mask)
	}
	let confirmed = {x: 100, y: 200}
	await expect(
		performInputAction(
			client,
			{action: 'mouse_move', coordinate: [700, 200]},
			{
				pointerSupported: true,
				pointer: confirmed,
				onPosition: (point) => {
					confirmed = point
				},
			},
		),
	).rejects.toThrow('display closed')
	expect(confirmed.x).toBeGreaterThan(100)
	expect(confirmed.x).toBeLessThanOrEqual(300)
	expect(events.at(-1)).toEqual(['pointer', confirmed.x, confirmed.y, 0])
})

test('typing with a coordinate glides to the focused input before typing, without clicking', async () => {
	const {client, events} = fakeClient(1920, 1080)
	const updates: InputUpdate[] = []
	const result = await performInputAction(
		client,
		{action: 'type', text: 'Hi', coordinate: [784, 441]},
		{
			pointerSupported: true,
			pointer: {x: 100, y: 100},
			onUpdate: (update) => updates.push(update),
		},
	)
	expect(result.pointer).toEqual({x: 960, y: 540})
	const firstKey = events.findIndex((event) => event[0] === 'key')
	expect(firstKey).toBeGreaterThan(0)
	expect(events[firstKey - 1]).toEqual(['pointer', 960, 540, 0])
	expect(events.slice(firstKey).every((event) => event[0] === 'key')).toBe(true)
	expect(pointerEvents(events).every((event) => event[3] === 0)).toBe(true)
	expect(updates.map((update) => update.feedback.phase)).toEqual(['moving', 'active', 'complete'])
	expect(updates[1].pointer).toEqual({x: 960, y: 540})
})

test('typing on a pointer machine must say where the text goes, before any key is sent', async () => {
	const {client, events} = fakeClient(800, 600)
	await expect(control(client, {action: 'type', text: 'hello'})).rejects.toThrow(
		'[machine-input-invalid] coordinate is required for type',
	)
	expect(events).toStrictEqual([])
})

test('typing without a target preserves the pointer on keyboard-only machines', async () => {
	const {client, events} = fakeClient(800, 600)
	await expect(
		performInputAction(client, {action: 'type', text: 'a'}, {pointerSupported: false, pointer: {x: 5, y: 6}}),
	).resolves.toEqual({pointer: {x: 5, y: 6}})
	expect(pointerEvents(events)).toEqual([])
	expect(events).toEqual([
		['key', 97, true],
		['key', 97, false],
	])
})
