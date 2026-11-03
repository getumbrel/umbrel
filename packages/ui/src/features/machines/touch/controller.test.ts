import {beforeEach, expect, it, vi} from 'vitest'

import type {Camera} from './camera'
import {Controller} from './controller'
import type {Guest} from './guest'
import {XK} from './keysyms'

function makeGuest(paced = false) {
	const keys: [number, boolean][] = []
	const guest = {
		width: 1280,
		height: 640,
		x: 640,
		y: 320,
		paced,
		pointer: vi.fn(),
		key: (keysym: number, down: boolean) => keys.push([keysym, down]),
	} as unknown as Guest
	return {guest, keys}
}

const camera = {makeRoom: vi.fn(), s: 1} as unknown as Camera

beforeEach(() => {
	vi.useFakeTimers()
})

it('keeps a latched modifier out of the guest until the key it modifies', () => {
	const {guest, keys} = makeGuest()
	const controller = new Controller(guest, camera)
	controller.tapModifier('ctrl')
	expect(keys).toEqual([])
	controller.tapKey(0x63)
	expect(keys).toEqual([
		[XK.Control, true],
		[0x63, true],
		[0x63, false],
		[XK.Control, false],
	])
	expect(controller.modifiers.ctrl).toBe('off')
})

it('holds a double-tapped modifier down until it is tapped off', () => {
	const {guest, keys} = makeGuest()
	const controller = new Controller(guest, camera)
	controller.tapModifier('alt')
	controller.tapModifier('alt')
	expect(controller.modifiers.alt).toBe('locked')
	controller.tapKey(0x61)
	expect(controller.modifiers.alt).toBe('locked')
	expect(keys.at(-1)).toEqual([0x61, false])
	controller.tapModifier('alt')
	expect(controller.modifiers.alt).toBe('off')
	expect(keys.at(-1)).toEqual([XK.Alt, false])
})

it('applies a latched modifier to a click, then lets it go', () => {
	const {guest, keys} = makeGuest()
	const controller = new Controller(guest, camera)
	controller.tapModifier('ctrl')
	controller.click(1)
	expect(keys).toEqual([
		[XK.Control, true],
		[XK.Control, false],
	])
	expect(controller.modifiers.ctrl).toBe('off')
})

it('sends everything typed down one line, so an arrow cannot overtake letters', async () => {
	const {guest, keys} = makeGuest(true)
	const controller = new Controller(guest, camera)
	controller.typeText('a')
	controller.keyDown(XK.Left)
	controller.keyUp(XK.Left)
	await vi.runAllTimersAsync()
	expect(keys.map(([keysym]) => keysym)).toEqual([0x61, 0x61, XK.Left, XK.Left])
})
