// @vitest-environment jsdom

import type {Map as MapLibreMap} from 'maplibre-gl'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('The map credit', () => {
	let Attribution: typeof import('./attribution').Attribution
	let container: HTMLDivElement
	let mapElement: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(async () => {
		// What has been seen is the module's to remember: each test has a new one
		vi.resetModules()
		;({Attribution} = await import('./attribution'))
		vi.useFakeTimers()
		container = document.createElement('div')
		mapElement = document.createElement('div')
		document.body.append(container, mapElement)
		mount()
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		mapElement.remove()
		vi.useRealTimers()
	})

	// A map coming into sight, with its credit
	function mount() {
		root = createRoot(container)
		const map = {getContainer: () => mapElement} as unknown as MapLibreMap
		act(() => root.render(<Attribution map={map} />))
	}
	const link = () => container.querySelector('a')
	const press = () => act(() => container.querySelector('button')!.click())
	const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))

	test('is out the first time a map is, and put away 5 seconds on', () => {
		expect(link()?.textContent).toBe('© OpenStreetMap')
		wait(4999)
		expect(link()).not.toBeNull()
		wait(1)
		expect(link()).toBeNull()
	})

	test.each(['pointerdown', 'wheel'])('is put away by a %s on the map', (type) => {
		// … even one that goes no further than the map, as a trackpad's scroll doesn't
		mapElement.addEventListener(type, (event) => event.stopPropagation(), {capture: true})
		const canvas = mapElement.appendChild(document.createElement('canvas'))
		act(() => void canvas.dispatchEvent(new Event(type, {bubbles: true})))
		expect(link()).toBeNull()
	})

	test('starts put away from then on, and still opens by its button', () => {
		wait(5000)
		act(() => root.unmount())
		mount()
		expect(link()).toBeNull()
		press()
		expect(link()).not.toBeNull()
		// Asked for, it stays out until the button puts it away
		wait(5000)
		act(() => void mapElement.dispatchEvent(new Event('pointerdown')))
		expect(link()).not.toBeNull()
		press()
		expect(link()).toBeNull()
	})

	test('put away by its button, it has been seen', () => {
		press()
		expect(link()).toBeNull()
		press()
		wait(5000)
		expect(link()).not.toBeNull()
		act(() => root.unmount())
		mount()
		expect(link()).toBeNull()
	})

	test('comes back out if it went away before it was put away', () => {
		wait(500)
		act(() => root.unmount())
		mount()
		expect(link()).not.toBeNull()
	})
})
