// @vitest-environment jsdom

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeAll, expect, test, vi} from 'vitest'

import {openDocument} from '@/features/files/components/file-viewer/document-viewer/engine'
import {docx} from '@/features/files/components/file-viewer/document-viewer/engine/test-helpers'
import {FormatBar} from '@/features/files/components/file-viewer/document-viewer/format-bar'
import {ZipArchive} from '@/features/files/components/file-viewer/shared/zip'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/modules/auth/http-auth', () => ({useAuthorizedHttpUrl: (url?: string) => url}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no layout for the document to say where its caret went
beforeAll(() => {
	Range.prototype.getClientRects = () => Object.assign([], {item: () => null}) as unknown as DOMRectList
	Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const BODY =
	'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Bold </w:t></w:r><w:r><w:t>plain</w:t></w:r></w:p>'

test('the bar says what the selected text is and switches it, and takes edits back and forth', async () => {
	const doc = await openDocument(docx(BODY))
	const pages = document.createElement('div')
	const stage = document.createElement('div')
	document.body.append(pages, stage)
	const root = createRoot(stage)
	// As the viewer has it: the document says when it changed, and the bar is drawn again with a new version
	let version = 0
	await doc.render(pages, {onChange: () => version++})
	const draw = () =>
		act(async () =>
			root.render(
				<TooltipPrimitive.Provider>
					<FormatBar ref={null} doc={doc} version={version} />
				</TooltipPrimitive.Provider>,
			),
		)
	// Each button by name: * when it's on, - when it can't be pressed
	const buttons = () => [...stage.querySelectorAll('button')]
	const name = (button: HTMLButtonElement) => button.getAttribute('aria-label')!.split('.')[1]
	const state = () =>
		buttons().map(
			(button) =>
				name(button) + (button.getAttribute('aria-pressed') === 'true' ? '*' : '') + (button.disabled ? '-' : ''),
		)
	const press = async (label: string) => {
		await act(async () =>
			buttons()
				.find((button) => name(button) === label)!
				.click(),
		)
		await draw()
	}
	// The selection, in the text of the run showing a word; the browser says when it moved
	const text = (word: string) =>
		[...pages.querySelectorAll('span')].find((span) => span.textContent === word)!.firstChild!
	const select = (word: string, from: number, to = from) =>
		act(async () => {
			document.getSelection()!.setBaseAndExtent(text(word), from, text(word), to)
			document.dispatchEvent(new Event('selectionchange'))
			await new Promise(requestAnimationFrame)
		})
	const body = async () => {
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		return xml.slice(xml.indexOf('<w:body>') + 8, xml.indexOf('</w:body>'))
	}

	// With no selection in the text there's nothing to format, and nothing has been done to take back
	doc.setEditable(true)
	await draw()
	expect(state()).toEqual(['bold-', 'italic-', 'underline-', 'undo-', 'redo-'])
	await select('plain', 1, 4)
	expect(state()).toEqual(['bold', 'italic', 'underline', 'undo-', 'redo-'])

	// A press on the bar leaves the keyboard, and so the selection, in the text
	const down = new MouseEvent('mousedown', {bubbles: true, cancelable: true})
	stage.querySelector('[role=toolbar]')!.dispatchEvent(down)
	expect(down.defaultPrevented).toBe(true)
	await press('bold')
	expect(await body()).toContain('<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>lai</w:t></w:r>')
	expect(document.getSelection()!.toString()).toBe('lai')
	expect(state()).toEqual(['bold*', 'italic', 'underline', 'undo', 'redo-'])

	// It follows the caret from text that's bold to text that isn't
	await select('Bold ', 2)
	expect(state()).toEqual(['bold*', 'italic', 'underline', 'undo', 'redo-'])
	await select('n', 1)
	expect(state()).toEqual(['bold', 'italic', 'underline', 'undo', 'redo-'])
	// Switched on at a caret, for what's typed there next
	await press('italic')
	expect(state()).toEqual(['bold', 'italic*', 'underline', 'undo', 'redo-'])

	await press('undo')
	expect(await body()).toBe(BODY)
	expect(state()).toEqual(['bold', 'italic', 'underline', 'undo-', 'redo'])
	await press('redo')
	expect(state()).toEqual(['bold*', 'italic', 'underline', 'undo', 'redo-'])

	await act(async () => root.unmount())
	doc.destroy()
	pages.remove()
	stage.remove()
})
