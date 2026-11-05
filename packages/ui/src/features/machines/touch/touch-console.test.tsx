// @vitest-environment jsdom

import {expect, it, vi} from 'vitest'

import {deckHeightFor, desktopFor} from './touch-console'

vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('motion/react', async (original) => original())

const glass = (width: number, height: number) => ({
	width,
	height,
	keyboard: 0,
	safe: {top: 0, right: 0, bottom: 0, left: 0},
})

it('keeps one landscape desktop per display, shaped for the display on its side', () => {
	// A tablet shows its desktop at full width, so it asks for its own pixels
	expect(desktopFor({long: 1180, short: 820})).toEqual({width: 1180, height: 820})
	// 4:3 at most, however square the display
	expect(desktopFor({long: 1366, short: 1200})).toEqual({width: 1366, height: 1025})
	// An iPhone Duo's inner display can't hold real apps at its own size
	expect(desktopFor({long: 951, short: 669})).toEqual({width: 1280, height: 900})
})

it('gives every phone a short desktop, whatever the shape of its screen', () => {
	expect(desktopFor({long: 852, short: 393})).toEqual({width: 1280, height: 640})
	// The Duo's outer display is nearly 3:2, but only a slice of the desktop shows
	// upright, and a taller desktop would make that slice unreadable
	expect(desktopFor({long: 678, short: 466})).toEqual({width: 1280, height: 640})
})

it('gives the deck what a readable desktop leaves', () => {
	expect(deckHeightFor(glass(820, 1180), {width: 1180, height: 820}, false)).toBe(610)
	expect(deckHeightFor(glass(669, 902), {width: 1280, height: 900}, false)).toBe(432)
})

it('keeps a phone deck short, so the desktop gets the height', () => {
	expect(deckHeightFor(glass(393, 852), {width: 1280, height: 640}, false)).toBe(340)
	expect(deckHeightFor(glass(382, 618), {width: 1280, height: 640}, false)).toBe(260)
	expect(deckHeightFor(glass(393, 852), {width: 1280, height: 640}, true)).toBe(348)
})
