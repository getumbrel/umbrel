// @vitest-environment jsdom

import * as Dialog from '@radix-ui/react-dialog'
import {act} from 'react'
import {flushSync} from 'react-dom'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {isBeneathModal} from './is-beneath-modal'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function render({open, modal = true}: {open: boolean; modal?: boolean}) {
	const tree = (
		<>
			<div id='page' />
			<Dialog.Root open={open} modal={modal}>
				<Dialog.Portal>
					<Dialog.Content aria-describedby={undefined}>
						<Dialog.Title>Logs</Dialog.Title>
						<div id='in-dialog' />
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	)
	act(() => root.render(tree))
}

// What a page-level shortcut sees: the answer as its window listener runs, last of all
function pressKey(key: string, ask: (event: KeyboardEvent) => boolean) {
	let answer: boolean | undefined
	const listener = (event: KeyboardEvent) => (answer = ask(event))
	window.addEventListener('keydown', listener)
	act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true})))
	window.removeEventListener('keydown', listener)
	return answer
}

const beneathModal = (id: string) => pressKey('a', (event) => isBeneathModal(document.getElementById(id), event))

// The check rides on what Radix does to the rest of the page while a modal is
// open, so these pin that behaviour as much as the function
describe('isBeneathModal', () => {
	it('is true of the page while a modal is open over it, and only then', () => {
		render({open: false})
		expect(beneathModal('page')).toBe(false)
		render({open: true})
		expect(beneathModal('page')).toBe(true)
		render({open: false})
		expect(beneathModal('page')).toBe(false)
	})

	it('is false of what is inside the modal', () => {
		render({open: true})
		expect(beneathModal('in-dialog')).toBe(false)
	})

	it('is false beneath a layer that is not modal, like the sheet a page sits in', () => {
		render({open: true, modal: false})
		expect(beneathModal('page')).toBe(false)
	})

	it('still holds for the key that closes the modal', () => {
		render({open: true})
		// As Radix does on Escape: ahead of the page's listeners, and all at once
		const close = () => flushSync(() => root.render(<div id='page' />))
		document.addEventListener('keydown', close, {capture: true, once: true})

		expect(pressKey('Escape', (event) => isBeneathModal(document.getElementById('page'), event))).toBe(true)
		expect(document.getElementById('in-dialog')).toBeNull()
	})

	it('is false of an element that is not there', () => {
		expect(pressKey('a', (event) => isBeneathModal(null, event))).toBe(false)
	})
})
