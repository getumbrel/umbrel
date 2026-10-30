// @vitest-environment jsdom

import type RFB from '@novnc/novnc'
import {afterEach, expect, it, vi} from 'vitest'

import {
	clipboardShortcut,
	releaseShortcutModifiers,
	sendClipboardShortcut,
	sendDelayedPasteShortcut,
	typeIntoConsole,
} from './console-clipboard'

afterEach(() => vi.useRealTimers())

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)

function recordingConsole() {
	const keys: Array<[number, string | null, boolean | undefined]> = []
	const rfb = {sendKey: (keysym: number, code: string | null, down?: boolean) => keys.push([keysym, code, down])}
	return {rfb: rfb as unknown as RFB, keys}
}

it('intercepts pastes everywhere but only remaps ⌘ shortcuts on a Mac', () => {
	expect(clipboardShortcut(key({key: 'v', code: 'KeyV', ctrlKey: true}), {mac: false})).toEqual({
		action: 'paste',
		fromCommand: false,
	})
	expect(clipboardShortcut(key({key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true}), {mac: false})?.action).toBe(
		'paste',
	)
	expect(clipboardShortcut(key({key: 'Insert', code: 'Insert', shiftKey: true}), {mac: false})?.action).toBe('paste')
	expect(clipboardShortcut(key({key: 'v', code: 'KeyV', metaKey: true}), {mac: true})).toEqual({
		action: 'paste',
		fromCommand: true,
	})
	expect(clipboardShortcut(key({key: 'c', code: 'KeyC', metaKey: true}), {mac: true})?.action).toBe('copy')

	// Ctrl+C stays the guest's own (an interrupt in a terminal), as does ⌘ off a
	// Mac and Ctrl+V on one, where it never makes the browser paste
	expect(clipboardShortcut(key({key: 'c', code: 'KeyC', ctrlKey: true}), {mac: false})).toBeUndefined()
	expect(clipboardShortcut(key({key: 'v', code: 'KeyV', ctrlKey: true}), {mac: true})).toBeUndefined()
	expect(clipboardShortcut(key({key: 'v', code: 'KeyV', metaKey: true}), {mac: false})).toBeUndefined()
	expect(clipboardShortcut(key({key: 'v', code: 'KeyV', ctrlKey: true, altKey: true}), {mac: false})).toBeUndefined()
	expect(clipboardShortcut(key({key: 'v', code: 'KeyV'}), {mac: true})).toBeUndefined()
})

it('leaves ⌘ as Super on Omarchy, still syncing pastes', () => {
	const options = {mac: true, omarchy: true}

	expect(clipboardShortcut(key({key: 'v', code: 'KeyV', metaKey: true}), options)).toEqual({
		action: 'paste',
		fromCommand: false,
	})
	expect(clipboardShortcut(key({key: 'c', code: 'KeyC', metaKey: true}), options)).toBeUndefined()
	expect(clipboardShortcut(key({key: 'x', code: 'KeyX', metaKey: true}), options)).toBeUndefined()
})

it('presses the modifiers itself when replaying a delayed paste', () => {
	const {rfb, keys} = recordingConsole()

	sendDelayedPasteShortcut(rfb, key({key: 'v', code: 'KeyV', metaKey: true}))
	sendDelayedPasteShortcut(rfb, key({key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true}))

	expect(keys).toEqual([
		[0xffeb, 'MetaLeft', true],
		[0x76, 'KeyV', undefined],
		[0xffeb, 'MetaLeft', false],
		[0xffe3, 'ControlLeft', true],
		[0xffe1, 'ShiftLeft', true],
		[0x76, 'KeyV', undefined],
		[0xffe3, 'ControlLeft', false],
		[0xffe1, 'ShiftLeft', false],
	])
})

it('lets go of a held shortcut before typing, without a lone Super tap', () => {
	const {rfb, keys} = recordingConsole()

	releaseShortcutModifiers(rfb, key({key: 'v', code: 'KeyV', metaKey: true}))

	expect(keys).toEqual([
		[0xffe3, 'ControlLeft', true],
		[0xffeb, 'MetaLeft', false],
		[0xffec, 'MetaRight', false],
		[0xffe3, 'ControlLeft', false],
	])
})

it('replays a Ctrl shortcut as just its key, since the guest already holds Ctrl', () => {
	const {rfb, keys} = recordingConsole()
	const event = key({key: 'v', code: 'KeyV', ctrlKey: true})

	sendClipboardShortcut(rfb, event, clipboardShortcut(event, {mac: false})!)

	expect(keys).toEqual([[0x76, 'KeyV', undefined]])
})

it('turns ⌘V into Ctrl+V without leaving the guest a lone Super tap', () => {
	const {rfb, keys} = recordingConsole()
	const event = key({key: 'v', code: 'KeyV', metaKey: true})

	sendClipboardShortcut(rfb, event, clipboardShortcut(event, {mac: true})!)

	expect(keys).toEqual([
		[0xffe3, 'ControlLeft', true],
		[0xffeb, 'MetaLeft', false],
		[0xffec, 'MetaRight', false],
		[0x76, 'KeyV', undefined],
		[0xffe3, 'ControlLeft', false],
	])
})

it('types plain text with Shift where a US keyboard needs it and skips what QEMU cannot type', async () => {
	vi.useFakeTimers()
	const {rfb, keys} = recordingConsole()

	const typing = typeIntoConsole(rfb, 'aB!\r\né', new AbortController().signal)
	await vi.runAllTimersAsync()
	await typing

	expect(keys).toEqual([
		[0x61, null, true],
		[0x61, null, false],
		[0xffe1, 'ShiftLeft', true],
		[0x42, null, true],
		[0x42, null, false],
		[0xffe1, 'ShiftLeft', false],
		[0xffe1, 'ShiftLeft', true],
		[0x21, null, true],
		[0x21, null, false],
		[0xffe1, 'ShiftLeft', false],
		[0xff0d, null, true],
		[0xff0d, null, false],
	])
})

it('stops typing when cancelled', async () => {
	vi.useFakeTimers()
	const {rfb, keys} = recordingConsole()
	const controller = new AbortController()

	const typing = typeIntoConsole(rfb, 'abc', controller.signal)
	await vi.advanceTimersByTimeAsync(30)
	controller.abort()
	await vi.runAllTimersAsync()
	await typing

	expect(keys.filter(([, , down]) => down)).toHaveLength(1)
})
