// @vitest-environment jsdom

import {act, createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {describe, expect, test, vi} from 'vitest'

import {fitScale, useChanges, type PdfSession} from '@/features/files/components/file-viewer/pdf-viewer'
import type {PDFViewer} from '@/features/files/components/file-viewer/pdf-viewer/pdfjs'

vi.mock('@/features/files/components/file-viewer/pdf-viewer/pdfjs', () => ({
	AnnotationEditorType: {NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, STAMP: 13, INK: 15, SIGNATURE: 101},
	AnnotationEditorParamsType: {},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
// pdf.js's number for its drawing mode
const INK = 15

// A page of a size (CSS pixels at 100%) on a stage of a size, as the viewer measures them
const viewer = (stage: [number, number], page: [number, number]) =>
	({
		container: {clientWidth: stage[0], clientHeight: stage[1]},
		currentPageNumber: 1,
		getPageView: () => ({width: page[0], height: page[1], scale: 1}),
	}) as unknown as PDFViewer
const opened = (stage: [number, number], page: [number, number]) =>
	Math.round(fitScale(viewer(stage, page), 'auto') * 100)

// The stages a 1440×900 window, a 1024×768 iPad, a 390×844 phone and that phone on its side give the pages
const DESKTOP: [number, number] = [1440, 800]
const TABLET: [number, number] = [1024, 668]
const PHONE: [number, number] = [390, 692]
const PHONE_ON_ITS_SIDE: [number, number] = [844, 234]
const PORTRAIT: [number, number] = [816, 1056]
const LANDSCAPE: [number, number] = [1056, 816]
const SLIDE: [number, number] = [1280, 720]

describe('the zoom a PDF opens at', () => {
	test('a portrait page fills the width, up to 125%', () => {
		expect([DESKTOP, TABLET, PHONE, PHONE_ON_ITS_SIDE].map((stage) => opened(stage, PORTRAIT))).toEqual([
			125, 120, 44, 98,
		])
	})

	test('a landscape page or a slide is shown whole where that leaves it readable', () => {
		expect([opened(DESKTOP, LANDSCAPE), opened(TABLET, LANDSCAPE), opened(PHONE, LANDSCAPE)]).toEqual([94, 78, 34])
		expect([opened(DESKTOP, SLIDE), opened(TABLET, SLIDE)]).toEqual([107, 76])
	})

	test('and fills the width where whole it would be tiny, as on a phone on its side', () => {
		expect([opened(PHONE_ON_ITS_SIDE, LANDSCAPE), opened(PHONE_ON_ITS_SIDE, SLIDE)]).toEqual([75, 62])
	})
})

// pdf.js's side of saving: the annotation storage, and the markup it holds until it lets go of it — a text box being
// typed into, and a drawing's strokes
function fakeSession() {
	const storage = new Map<string, {serialize: () => unknown}>()
	let typing: {text: string; isEmpty: () => boolean} | null = null
	let mode = 0
	let strokes = 0
	const storedWhenSaving: string[][] = []
	// A page's markup layer: a press on it with Draw in hand is a stroke
	const layer = {
		div: document.body.appendChild(document.createElement('div')),
		endDrawingSession: () => {
			const drawn = strokes
			if (drawn) storage.set('drawing', {serialize: () => ({strokes: drawn})})
			strokes = 0
			return drawn ? {} : null
		},
	}
	layer.div.addEventListener('pointerdown', () => mode === INK && strokes++)
	const editors = {
		getActive: () => typing,
		commitOrRemove: () => {
			const text = typing?.text
			if (text) storage.set('note', {serialize: () => ({value: text})})
			typing = null
		},
		getMode: () => mode,
		findParent: () => layer,
	}
	const pdf = {
		annotationStorage: storage,
		getFieldObjects: async () => null,
		saveDocument: async () => {
			storedWhenSaving.push([...storage.keys()])
			return new Uint8Array()
		},
	}
	const eventBus = {on: () => {}, off: () => {}}
	const type = (text: string) => {
		typing = {text, isEmpty: () => !text.trim()}
	}
	const pick = (tool: number) => (mode = tool)
	return {session: {pdf, editors, eventBus} as unknown as PdfSession, type, pick, page: layer.div, storedWhenSaving}
}

test('markup pdf.js still holds — text being typed, a drawing — is a change, and saving lets go of it first', async () => {
	const {session, type, pick, page, storedWhenSaving} = fakeSession()
	let changes!: ReturnType<typeof useChanges>
	const Probe = () => {
		changes = useChanges(session, true)
		return null
	}
	const root = createRoot(document.createElement('div'))
	await act(async () => root.render(createElement(Probe)))
	const keyup = () =>
		act(async () => {
			window.dispatchEvent(new Event('keyup'))
			await new Promise(requestAnimationFrame)
		})
	const press = (target: Element) =>
		act(async () => {
			target.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}))
			target.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}))
			await new Promise(requestAnimationFrame)
		})

	// A text box placed, with nothing typed in it yet
	type('')
	await keyup()
	expect(changes.dirty).toBe(false)
	type('Looks good')
	await keyup()
	expect(changes.dirty).toBe(true)

	// Save, pressed on the chrome, never blurs the text box
	await act(async () => void (await changes.serialize()))
	expect(storedWhenSaving).toEqual([['note']])
	await act(async () => changes.saved())
	expect(changes.dirty).toBe(false)

	// Draw in hand: a press off the page draws nothing, a stroke on it is held by pdf.js
	pick(INK)
	await press(document.body)
	expect(changes.dirty).toBe(false)
	await press(page)
	expect(changes.dirty).toBe(true)

	// Nor does Save, pressed on the chrome, end the drawing
	await act(async () => void (await changes.serialize()))
	expect(storedWhenSaving).toEqual([['note'], ['note', 'drawing']])
	await act(async () => changes.saved())
	expect(changes.dirty).toBe(false)
	await act(async () => root.unmount())
})
