// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useViewerEscape, ViewerTools} from '@/features/files/components/file-viewer/shell/context'
import {QuickLook} from '@/features/files/components/file-viewer/shell/quick-look'
import type {Viewer, ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('motion/react', () => ({useReducedMotion: () => true}))
vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => false}))
vi.mock('@/hooks/use-language', () => ({useLanguage: () => ['en']}))
vi.mock('@/modules/auth/http-auth', () => ({useAuthorizedHttpUrl: (url?: string) => url}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const file = (path: string, type = 'text/plain'): FileSystemItem =>
	({name: path.slice(path.lastIndexOf('/') + 1), path, type, size: 3, modified: 0, operations: []}) as FileSystemItem

// A viewer with a tool for the toolbar, and a search that Escape unwinds first
const look = vi.hoisted(() => ({escape: false}))
function FakeViewer({item}: ViewerProps) {
	useViewerEscape(() => look.escape)
	return (
		<>
			<ViewerTools>
				<button type='button'>tool</button>
			</ViewerTools>
			<p data-testid='stage'>{item.path}</p>
		</>
	)
}
// Opened, it would keep the arrows: a quick look steps on regardless
const fakeViewer: Viewer = {Component: FakeViewer, preload: async () => {}, ownsArrows: true}

describe('QuickLook', () => {
	let container: HTMLDivElement
	let root: Root
	const step = vi.fn()

	beforeEach(() => {
		look.escape = false
		step.mockClear()
		useFilesStore.setState({
			viewerItem: file('/Home/a.txt'),
			viewerMode: 'preview',
			viewerNavigationGuard: null,
			viewerStepper: {step, canStep: () => true},
		})
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
	})

	function Look({viewer}: {viewer?: Viewer}) {
		const item = useFilesStore((s) => s.viewerItem)
		return item ? <QuickLook item={item} viewer={viewer} /> : null
	}
	const mount = async (viewer?: Viewer) => {
		await act(async () =>
			root.render(
				<ImmersiveDialogProvider>
					<Look viewer={viewer} />
				</ImmersiveDialogProvider>,
			),
		)
		await act(async () => {})
	}
	const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')
	// From the focused element, so it travels through the document (where Radix
	// listens for Escape) up to the window (where the quick look listens)
	const key = async (init: KeyboardEventInit) => {
		const target = document.activeElement ?? document.body
		await act(
			async () => void target.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ...init})),
		)
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
	}
	const closed = () => useFilesStore.getState().viewerItem === null

	test('is a dialog named for the file, with no toolbar: the viewer’s tools aren’t shown, and only the edge arrows and the close are buttons', async () => {
		await mount(fakeViewer)
		const dialog = panel()!
		expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('a.txt')
		expect(dialog.querySelector('[data-testid="stage"]')?.textContent).toBe('/Home/a.txt')
		expect(
			[...document.querySelectorAll('button, a')].map(
				(button) => button.getAttribute('aria-label') ?? button.textContent,
			),
		).toEqual(['files-viewer.previous', 'files-viewer.next', 'close'])
	})

	test('something Files has no viewer for is its card, named once', async () => {
		useFilesStore.setState({viewerItem: file('/Home/Trip', 'directory')})
		await mount()
		const dialog = panel()!
		expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.className).toBe('sr-only')
		expect(dialog.querySelector('[data-testid="stage"]')).toBeNull()
		expect(dialog.textContent).toContain('files-viewer.modified')
	})

	test('takes the keyboard from the listing, and hands it back as it closes', async () => {
		const listingItem = document.body.appendChild(document.createElement('div'))
		listingItem.tabIndex = 0
		listingItem.focus()
		await mount(fakeViewer)
		expect(document.activeElement).toBe(panel())

		await key({key: ' '})
		expect(closed()).toBe(true)
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(document.activeElement).toBe(listingItem)
		listingItem.remove()
	})

	test('Space closes it', async () => {
		await mount(fakeViewer)
		await key({key: ' '})
		expect(closed()).toBe(true)
	})

	test('Escape closes it, once the viewer has nothing of its own to unwind', async () => {
		await mount(fakeViewer)
		look.escape = true
		await key({key: 'Escape'})
		expect(closed()).toBe(false)

		look.escape = false
		await key({key: 'Escape'})
		expect(closed()).toBe(true)
	})

	test('a click on the scrim closes it', async () => {
		await mount(fakeViewer)
		const scrim = [...document.querySelectorAll<HTMLElement>('[data-state="open"]')].find(
			(element) => element !== panel() && !element.contains(panel()),
		)!
		await act(async () => scrim.click())
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(closed()).toBe(true)
	})

	test('←/→ step through the folder, even for a file that would keep them once opened', async () => {
		await mount(fakeViewer)
		await key({key: 'ArrowRight'})
		await key({key: 'ArrowLeft'})
		expect(step.mock.calls).toEqual([['next'], ['previous']])
		expect(closed()).toBe(false)
	})
})
