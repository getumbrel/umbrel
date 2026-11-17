// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {PhotosSelectionProvider, usePhotosSelection} from './selection-context'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let selection!: ReturnType<typeof usePhotosSelection>
function Probe() {
	selection = usePhotosSelection()
	return null
}

let container!: HTMLDivElement
let root!: Root

beforeEach(() => {
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() =>
		root.render(
			<MemoryRouter initialEntries={['/photos']}>
				<PhotosSelectionProvider>
					<Probe />
				</PhotosSelectionProvider>
			</MemoryRouter>,
		),
	)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

// The rest of a list, still on its way
function pending() {
	let arrive!: (ids: string[] | null) => void
	const rest = new Promise<string[] | null>((resolve) => (arrive = resolve))
	return {rest, arrive: (ids: string[] | null) => act(async () => arrive(ids))}
}

describe('selectAll', () => {
	it('selects what is loaded at once and everything once the rest arrives', async () => {
		const {rest, arrive} = pending()
		act(() => selection.selectAll(['a', 'b'], rest))
		expect([...selection.ids]).toEqual(['a', 'b'])
		expect(selection.selectingAll).toBe(true)

		await arrive(['a', 'b', 'c', 'd'])
		expect([...selection.ids]).toEqual(['a', 'b', 'c', 'd'])
		expect(selection.selectingAll).toBe(false)
	})

	it('keeps what is selected in other lists', async () => {
		const {rest, arrive} = pending()
		act(() => selection.selectAll(['a'], rest, ['elsewhere']))
		expect([...selection.ids].sort()).toEqual(['a', 'elsewhere'])
		await arrive(['a', 'b'])
		expect([...selection.ids].sort()).toEqual(['a', 'b', 'elsewhere'])
	})

	it('stands by what the user does with the selection meanwhile', async () => {
		const {rest, arrive} = pending()
		act(() => selection.selectAll(['a', 'b'], rest))
		act(() => selection.toggle('b'))
		expect(selection.selectingAll).toBe(false)
		await arrive(['a', 'b', 'c', 'd'])
		expect([...selection.ids]).toEqual(['a'])
	})

	it('is ended by Done', async () => {
		const {rest, arrive} = pending()
		act(() => selection.selectAll(['a', 'b'], rest))
		act(() => selection.done())
		await arrive(['a', 'b', 'c', 'd'])
		expect(selection.ids.size).toBe(0)
		expect(selection.selecting).toBe(false)
	})

	it('keeps what was loaded when the rest cannot be had', async () => {
		const {rest, arrive} = pending()
		act(() => selection.selectAll(['a', 'b'], rest))
		await arrive(null)
		expect([...selection.ids]).toEqual(['a', 'b'])
		expect(selection.selectingAll).toBe(false)
	})

	it('answers only the latest of two', async () => {
		const first = pending()
		const second = pending()
		act(() => selection.selectAll(['a'], first.rest))
		act(() => selection.selectAll(['a', 'b'], second.rest))
		await first.arrive(['a', 'b', 'c'])
		expect([...selection.ids]).toEqual(['a', 'b'])
		expect(selection.selectingAll).toBe(true)
		await second.arrive(['a', 'b', 'c', 'd'])
		expect([...selection.ids]).toEqual(['a', 'b', 'c', 'd'])
	})
})
