// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import type {PdfSession} from '@/features/files/components/file-viewer/pdf-viewer'
import {useMarkup} from '@/features/files/components/file-viewer/pdf-viewer/markup'

// pdf.js's own numbers for its editing modes and their settings
const NONE = 0
const INK = 15
vi.mock('@/features/files/components/file-viewer/pdf-viewer/pdfjs', () => ({
	AnnotationEditorType: {NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, STAMP: 13, INK: 15, SIGNATURE: 101},
	AnnotationEditorParamsType: {
		CREATE: 2,
		FREETEXT_SIZE: 11,
		FREETEXT_COLOR: 12,
		INK_COLOR: 21,
		INK_THICKNESS: 22,
		HIGHLIGHT_COLOR: 31,
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// pdf.js's side of markup: its event bus, and a viewer that reports each editing mode it's put in
function fakeSession() {
	const listeners = new Map<string, Set<(event: unknown) => void>>()
	const eventBus = {
		on: (name: string, listener: (event: unknown) => void) =>
			listeners.set(name, (listeners.get(name) ?? new Set()).add(listener)),
		off: (name: string, listener: (event: unknown) => void) => listeners.get(name)?.delete(listener),
		dispatch: (name: string, event: unknown) => listeners.get(name)?.forEach((listener) => listener(event)),
	}
	const viewer = {
		set annotationEditorMode({mode}: {mode: number}) {
			eventBus.dispatch('annotationeditormodechanged', {mode})
		},
	}
	return {eventBus, viewer} as unknown as PdfSession
}

let markup: ReturnType<typeof useMarkup>
function Probe({session}: {session: PdfSession}) {
	markup = useMarkup(session, true)
	return null
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
	container = document.createElement('div')
	root = createRoot(container)
})
afterEach(async () => {
	await act(async () => root.unmount())
})

test('Escape lets go of the annotation in hand, then the tool, then markup, and only then reaches the viewer', async () => {
	const session = fakeSession()
	await act(async () => root.render(<Probe session={session} />))
	await act(async () => markup.toggle())
	await act(async () => markup.use(INK))
	const escape = async () => {
		let used = false
		await act(async () => void (used = markup.unwind()))
		return used
	}

	// pdf.js lets go of the annotation itself
	const editing = {hasSomethingToUndo: false, hasSomethingToRedo: false}
	await act(async () =>
		session.eventBus.dispatch('editingstateschanged', {details: {...editing, hasSelectedEditor: true}}),
	)
	expect(await escape()).toBe(true)
	expect(markup.tool).toBe(INK)
	await act(async () =>
		session.eventBus.dispatch('editingstateschanged', {details: {...editing, hasSelectedEditor: false}}),
	)

	expect(await escape()).toBe(true)
	expect([markup.on, markup.tool]).toEqual([true, NONE])
	expect(await escape()).toBe(true)
	expect(markup.on).toBe(false)
	expect(await escape()).toBe(false)
})
