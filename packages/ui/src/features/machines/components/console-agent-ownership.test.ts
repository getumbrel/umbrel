// @vitest-environment jsdom
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import type RFB from '@novnc/novnc'
import Cursor from '@novnc/novnc/lib/util/cursor.js'
import {expect, it, vi} from 'vitest'

import {setConsoleAgentOwnership} from './console-agent-ownership'

it('still finds the private cursor canvas in the installed noVNC', () => {
	// The ownership helper reaches into RFB._cursor._canvas. Guard the pin so a
	// noVNC bump that renames either field fails here instead of silently
	// showing two cursors in the console.
	const cursor = new Cursor() as unknown as {_canvas?: unknown}
	expect(cursor._canvas).toBeInstanceOf(HTMLCanvasElement)
	const rfbSource = readFileSync(createRequire(import.meta.url).resolve('@novnc/novnc/lib/rfb.js'), 'utf8')
	expect(rfbSource).toMatch(/_cursor = new /)
})

it('warns once and leaves the connection usable when the cursor canvas is missing', () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	try {
		const rfb = {viewOnly: false, showDotCursor: true} as unknown as RFB
		setConsoleAgentOwnership(rfb, true)
		setConsoleAgentOwnership(rfb, false)
		expect(rfb.viewOnly).toBe(false)
		expect(warn).toHaveBeenCalledOnce()
	} finally {
		warn.mockRestore()
	}
})

it('hides the fallback cursor while watching and restores it on takeover', () => {
	const canvas = document.createElement('canvas')
	const rfb = {viewOnly: false, showDotCursor: true, _cursor: {_canvas: canvas}} as unknown as RFB
	setConsoleAgentOwnership(rfb, true)
	expect(rfb.viewOnly).toBe(true)
	expect(rfb.showDotCursor).toBe(false)
	expect(canvas.classList.contains('opacity-0')).toBe(true)
	setConsoleAgentOwnership(rfb, false)
	expect(rfb.viewOnly).toBe(false)
	expect(rfb.showDotCursor).toBe(true)
	expect(canvas.classList.contains('opacity-0')).toBe(false)
})
