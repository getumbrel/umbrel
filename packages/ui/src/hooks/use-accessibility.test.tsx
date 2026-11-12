// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const root = document.documentElement

// The settings apply as the module loads, so each test loads its own copy
async function load({deviceWantsContrast = false} = {}) {
	vi.resetModules()
	vi.stubGlobal('matchMedia', () => ({matches: deviceWantsContrast, addEventListener() {}}))
	return import('./use-accessibility')
}

beforeEach(() => {
	localStorage.clear()
	root.removeAttribute('data-increase-contrast')
	root.style.removeProperty('--text-boost')
})

afterEach(() => {
	vi.unstubAllGlobals()
})

test('applies what this browser saved before anything renders', async () => {
	localStorage.setItem('umbrel-text-size', '3')
	localStorage.setItem('umbrel-increase-contrast', 'true')
	await load()

	expect(root.style.getPropertyValue('--text-boost')).toBe('3px')
	expect(root.hasAttribute('data-increase-contrast')).toBe(true)
})

test('falls back to the default size when the saved one is not a size', async () => {
	localStorage.setItem('umbrel-text-size', '9')
	await load()

	expect(root.style.getPropertyValue('--text-boost')).toBe('0px')
})

test("follows the device's contrast setting until one is chosen here", async () => {
	const {useIncreaseContrast} = await load({deviceWantsContrast: true})
	expect(root.hasAttribute('data-increase-contrast')).toBe(true)

	let setIncreaseContrast: (enabled: boolean) => void = () => {}
	function Probe() {
		setIncreaseContrast = useIncreaseContrast()[1]
		return null
	}
	const container = createRoot(document.createElement('div'))
	await act(async () => container.render(<Probe />))
	await act(async () => setIncreaseContrast(false))

	expect(root.hasAttribute('data-increase-contrast')).toBe(false)
	expect(localStorage.getItem('umbrel-increase-contrast')).toBe('false')
	await act(async () => container.unmount())
})
