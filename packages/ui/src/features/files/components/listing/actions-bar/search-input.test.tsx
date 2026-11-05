// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter, useLocation} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {SearchInput} from './search-input'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({
	useIsFilesReadOnly: () => false,
	useFilesCapabilities: () => ({}),
}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => false}))
vi.mock('@/features/files/hooks/use-home-path', () => ({
	useHomePath: () => '/Home',
	useTrashPath: () => '/Trash',
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const probe = {location: ''}
function LocationProbe() {
	const location = useLocation()
	probe.location = `${location.pathname}${location.search}`
	return null
}

describe('Files search input', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
	})

	const mount = async (initialPath: string) => {
		await act(async () =>
			root.render(
				<MemoryRouter initialEntries={[initialPath]}>
					<SearchInput />
					<LocationProbe />
				</MemoryRouter>,
			),
		)
	}
	const input = () => container.querySelector('input') as HTMLInputElement
	const exitButton = () => container.querySelector('button[aria-label="files-search.exit"]')
	const type = async (value: string) => {
		const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
		await act(async () => {
			setValue.call(input(), value)
			input().dispatchEvent(new Event('input', {bubbles: true}))
		})
	}

	it('shows the X only once something is typed, and it returns to the folder the search started from', async () => {
		await mount('/files/Home/Docs')
		expect(exitButton()).toBeNull()

		await type('foo')
		expect(probe.location).toBe('/files/Search?q=foo')
		expect(exitButton()).not.toBeNull()

		await act(async () => (exitButton() as HTMLButtonElement).click())
		expect(probe.location).toBe('/files/Home/Docs')
		expect(input().value).toBe('')
		expect(exitButton()).toBeNull()
	})

	it('falls back to the home directory when the search page was reached directly', async () => {
		await mount('/files/Search?q=foo')
		expect(input().value).toBe('foo')
		expect(exitButton()).not.toBeNull()

		await act(async () => (exitButton() as HTMLButtonElement).click())
		expect(probe.location).toBe('/files/Home')
	})

	it('Escape leaves search the same way', async () => {
		await mount('/files/Home/Docs')
		await type('foo')
		await act(async () => {
			input().dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
		})
		expect(probe.location).toBe('/files/Home/Docs')
		expect(input().value).toBe('')
	})

	it('keeps the folder it started from while the query changes on the search page', async () => {
		await mount('/files/Home/Docs')
		await type('f')
		await type('fo')
		await type('')
		await type('bar')
		expect(probe.location).toBe('/files/Search?q=bar')

		await act(async () => (exitButton() as HTMLButtonElement).click())
		expect(probe.location).toBe('/files/Home/Docs')
	})
})
