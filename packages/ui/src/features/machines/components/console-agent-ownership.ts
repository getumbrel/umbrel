import type RFB from '@novnc/novnc'

let warnedMissingCursor = false

export function setConsoleAgentOwnership(rfb: RFB, owned: boolean) {
	rfb.viewOnly = owned
	rfb.showDotCursor = !owned
	// noVNC 1.5 puts its touch/fallback cursor canvas on document.body, outside
	// our console's cursor-none rule. Isolate this private integration here;
	// opacity leaves noVNC's image and visibility bookkeeping intact for takeover.
	// Private API pinned to @novnc/novnc 1.5.0 (RFB._cursor is a util/cursor
	// Cursor whose _canvas is the element it appends to body); the unit test
	// checks the installed package still has this shape.
	const cursorCanvas = (rfb as RFB & {_cursor?: {_canvas?: HTMLCanvasElement}})._cursor?._canvas
	if (!cursorCanvas) {
		if (!warnedMissingCursor) {
			warnedMissingCursor = true
			console.warn('noVNC no longer exposes its fallback cursor canvas; the viewer will see two cursors while watching')
		}
		return
	}
	cursorCanvas.classList.toggle('opacity-0', owned)
}
