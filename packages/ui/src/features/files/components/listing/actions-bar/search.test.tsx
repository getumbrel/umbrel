// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter, useLocation} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {FilesSearchProvider} from '@/features/files/hooks/use-files-search'

import {MobileSearch, SearchPill} from './search'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('motion/react', () => ({
	motion: {
		div: ({children, className}: {children: React.ReactNode; className?: string}) => (
			<div className={className}>{children}</div>
		),
	},
}))
vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({
	useIsFilesReadOnly: () => false,
	useFilesCapabilities: () => ({}),
}))
vi.mock('@/features/files/hooks/use-home-path', () => ({
	useHomePath: () => '/Home',
	useTrashPath: () => '/Trash',
}))
// The field's arc follows Search's own progress, which is not under test here
vi.mock('@/features/search/use-search', () => ({useSearchStatus: () => undefined}))
vi.mock('@/features/search/use-search-footnote', () => ({
	useSearchFootnote: () => undefined,
	useSearchArc: () => undefined,
}))
vi.mock('@/utils/tw', () => ({useBreakpoint: () => '2xl'}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const probe = {location: ''}
function LocationProbe() {
	const location = useLocation()
	probe.location = `${location.pathname}${location.search}`
	return null
}

describe.each([
	['the bar pill', SearchPill],
	['the phone title row', MobileSearch],
] as const)('Files search in %s', (_name, Search) => {
	let container: HTMLDivElement
	let root: Root
	const isPill = Search === SearchPill

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
					<FilesSearchProvider>
						<Search />
						<LocationProbe />
					</FilesSearchProvider>
				</MemoryRouter>,
			),
		)
	}
	const input = () => container.querySelector('input') as HTMLInputElement
	const clearButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="files-search.exit"]')
	// What leaves the search: the pill's ×, the phone row's Cancel
	const leave = () =>
		isPill
			? clearButton()!
			: [...container.querySelectorAll('button')].find((button) => button.textContent === 'cancel')!
	const type = async (value: string) => {
		const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
		await act(async () => {
			setValue.call(input(), value)
			input().dispatchEvent(new Event('input', {bubbles: true}))
		})
	}

	it('shows the × only once something is typed, and leaving returns to the folder the search started from', async () => {
		await mount('/files/Home/Docs')
		expect(clearButton()).toBeNull()

		await type('foo')
		expect(probe.location).toBe('/files/Search?q=foo')
		expect(clearButton()).not.toBeNull()

		await act(async () => leave().click())
		expect(probe.location).toBe('/files/Home/Docs')
		expect(input()?.value ?? '').toBe('')
		expect(clearButton()).toBeNull()
	})

	it('falls back to the home directory when the search page was reached directly', async () => {
		await mount('/files/Search?q=foo')
		expect(input().value).toBe('foo')
		expect(clearButton()).not.toBeNull()

		await act(async () => leave().click())
		expect(probe.location).toBe('/files/Home')
	})

	it('Escape leaves search the same way', async () => {
		await mount('/files/Home/Docs')
		await type('foo')
		await act(async () => {
			input().dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
		})
		expect(probe.location).toBe('/files/Home/Docs')
		expect(input()?.value ?? '').toBe('')
	})

	it('keeps the folder it started from while the query changes on the search page', async () => {
		await mount('/files/Home/Docs')
		await type('f')
		await type('fo')
		await type('')
		await type('bar')
		expect(probe.location).toBe('/files/Search?q=bar')

		await act(async () => leave().click())
		expect(probe.location).toBe('/files/Home/Docs')
	})
})

describe('Files search on a phone', () => {
	it('empties the field with its ×, and stays on the results until Cancel', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)
		const root = createRoot(container)
		await act(async () =>
			root.render(
				<MemoryRouter initialEntries={['/files/Home/Docs']}>
					<FilesSearchProvider>
						<MobileSearch />
						<LocationProbe />
					</FilesSearchProvider>
				</MemoryRouter>,
			),
		)
		const input = container.querySelector('input') as HTMLInputElement
		const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
		await act(async () => {
			setValue.call(input, 'foo')
			input.dispatchEvent(new Event('input', {bubbles: true}))
		})
		await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="files-search.exit"]')!.click())
		expect(input.value).toBe('')
		expect(probe.location).toBe('/files/Search?q=foo')
		await act(async () => root.unmount())
		container.remove()
	})
})
