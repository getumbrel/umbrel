// @vitest-environment jsdom

import {TooltipProvider} from '@radix-ui/react-tooltip'
import {act, useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {createMemoryRouter, RouterProvider} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useViewerEscape, useViewerSave} from '@/features/files/components/file-viewer/shell/context'
import {ViewerShell} from '@/features/files/components/file-viewer/shell/viewer-shell'
import type {Viewer, ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

const mocks = vi.hoisted(() => ({invalidate: vi.fn()}))
afterEach(() => mocks.invalidate.mockClear())
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('motion/react', () => ({useReducedMotion: () => true}))
vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
vi.mock('@/providers/wallpaper', () => ({useWallpaper: () => ({wallpaper: {}}), WallpaperAvifSource: () => null}))
vi.mock('@/modules/auth/http-auth', () => ({
	useAuthorizedHttpUrl: (url?: string) => url,
	dashboardAuthHeaders: () => ({}),
}))
vi.mock('@/trpc/trpc', () => ({trpcReact: {useUtils: () => ({files: {list: {invalidate: mocks.invalidate}}})}}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const file = (path: string): FileSystemItem =>
	({
		name: path.slice(path.lastIndexOf('/') + 1),
		path,
		type: 'text/plain',
		size: 3,
		modified: 0,
		operations: ['writable'],
	}) as FileSystemItem

// A viewer with one editable value: typing makes it dirty, its revision
// follows what the shell reports back after each save
const editor = vi.hoisted(() => ({
	edit: undefined as undefined | ((text: string) => void),
	saved: [] as Array<string | undefined>,
	escape: false,
}))
function FakeEditor({item}: ViewerProps) {
	const [text, setText] = useState('one')
	const [baseline, setBaseline] = useState({text: 'one', revision: '"r1"' as string | undefined})
	editor.edit = setText
	useViewerSave(
		{
			revision: baseline.revision,
			serialize: async () => new Blob([text]),
			onSaved: (revision) => {
				editor.saved.push(revision)
				setBaseline({text, revision})
			},
		},
		text !== baseline.text,
	)
	useViewerEscape(() => editor.escape)
	return (
		<>
			<p data-testid='stage'>{item.path}</p>
			<div tabIndex={-1} data-testid='document' />
			<input aria-label='field' />
		</>
	)
}
const fakeViewer: Viewer = {Component: FakeEditor, preload: async () => {}}

type Upload = {url: string; ifMatch: string | null}
let uploads: Upload[]
let respond: (upload: Upload) => {status: number; etag?: string; path?: string}
// An upload waits for this before it's answered, while it's set
let hold: Promise<void> | undefined

describe('ViewerShell saving', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		uploads = []
		hold = undefined
		editor.saved = []
		editor.escape = false
		respond = () => ({status: 200, etag: `"r${uploads.length + 1}"`})
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: RequestInit) => {
				const upload = {url, ifMatch: new Headers(init.headers).get('If-Match')}
				uploads.push(upload)
				await hold
				const {status, etag, path} = respond(upload)
				const savedPath = path ?? decodeURIComponent(new URL(url, 'http://x').searchParams.get('path')!)
				return new Response(JSON.stringify({path: savedPath}), {status, headers: etag ? {ETag: etag} : {}})
			}),
		)
		useFilesStore.setState({viewerItem: file('/Home/a.txt'), viewerMode: 'open', viewerNavigationGuard: null})
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
		vi.unstubAllGlobals()
	})

	function Shell() {
		const item = useFilesStore((s) => s.viewerItem)
		return item ? <ViewerShell item={item} viewer={fakeViewer} /> : null
	}
	const mount = async () => {
		const router = createMemoryRouter([{path: '*', element: <Shell />}], {initialEntries: ['/files/Home']})
		await act(async () =>
			root.render(
				<ImmersiveDialogProvider>
					<TooltipProvider>
						<RouterProvider router={router} />
					</TooltipProvider>
				</ImmersiveDialogProvider>,
			),
		)
		await act(async () => {})
		return router
	}
	// The topmost dialog's button: a prompt's Save, not the toolbar's behind it
	const button = (name: string) =>
		[...([...document.querySelectorAll('[role="dialog"]')].at(-1)?.querySelectorAll('button') ?? [])].find(
			(candidate) => candidate.textContent?.trim() === name,
		)
	const click = async (name: string) => {
		const target = button(name)
		expect(target, `button "${name}"`).toBeTruthy()
		await act(async () => target!.click())
		await act(async () => {})
	}
	// From the focused element, so it travels through the document (where Radix
	// listens for Escape) up to the window (where the shell listens)
	const key = async (init: KeyboardEventInit) => {
		const target = document.activeElement ?? document.body
		await act(
			async () => void target.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ...init})),
		)
		await act(async () => {})
	}
	const edit = async (text: string) => act(async () => editor.edit!(text))

	test('Save appears with the first change and chains the server revision into the next If-Match', async () => {
		await mount()
		expect(button('files-viewer.save')).toBeUndefined()

		await edit('two')
		expect(document.querySelector('[aria-label="files-viewer.unsaved-changes"]')).not.toBeNull()
		await click('files-viewer.save')
		await edit('three')
		await key({key: 's', metaKey: true})

		expect(uploads.map((upload) => upload.ifMatch)).toEqual(['"r1"', '"r2"'])
		expect(uploads.every((upload) => upload.url.includes('collision=replace'))).toBe(true)
		expect(editor.saved).toEqual(['"r2"', '"r3"'])
		expect(mocks.invalidate).toHaveBeenCalledWith({path: '/Home'})
	})

	test('a save says how it went to assistive technology too', async () => {
		await mount()
		await edit('two')
		await key({key: 's', metaKey: true})
		expect(document.querySelector('[role="status"]')?.textContent).toBe('files-viewer.saved')

		respond = () => ({status: 500})
		await edit('three')
		await key({key: 's', metaKey: true})
		expect(document.querySelector('[role="status"]')?.textContent).toBe('files-viewer.save-failed')
	})

	test('a changed file offers Save as Copy, which lands beside it and becomes the open file', async () => {
		respond = (upload) => (upload.ifMatch ? {status: 412} : {status: 200, etag: '"c1"', path: '/Home/a (2).txt'})
		await mount()
		await edit('two')
		await key({key: 's', metaKey: true})
		expect(button('files-viewer.save-copy')).toBeTruthy()

		await click('files-viewer.save-copy')
		expect(uploads[1]).toEqual({url: expect.stringContaining('collision=keep-both'), ifMatch: null})
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a (2).txt')
		expect(useFilesStore.getState().selectedItems.map((item) => item.path)).toEqual(['/Home/a (2).txt'])
	})

	test('Replace overwrites the newer version without a revision check', async () => {
		respond = (upload) => (upload.ifMatch ? {status: 412} : {status: 200, etag: '"r9"'})
		await mount()
		await edit('two')
		await key({key: 's', metaKey: true})
		await click('files-viewer.replace')

		expect(uploads[1]).toEqual({url: expect.stringContaining('collision=replace'), ifMatch: null})
		expect(editor.saved).toEqual(['"r9"'])
		expect(document.querySelector('[aria-label="files-viewer.unsaved-changes"]')).toBeNull()
	})

	test('closing with unsaved changes asks first; Don\u2019t Save closes', async () => {
		await mount()
		await edit('two')
		await key({key: 'Escape'})
		expect(button('files-viewer.dont-save')).toBeTruthy()
		expect(useFilesStore.getState().viewerItem).not.toBeNull()

		await click('files-viewer.dont-save')
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(useFilesStore.getState().viewerItem).toBeNull()
		expect(uploads).toEqual([])
	})

	test('Save in the prompt saves, then carries on to the file the user was stepping to', async () => {
		await mount()
		await edit('two')
		await act(async () => void useFilesStore.getState().setViewerItem(file('/Home/b.txt'), 'open'))
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a.txt')

		await click('files-viewer.save')
		expect(uploads).toHaveLength(1)
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/b.txt')
	})

	test('closing the viewer from outside it asks first, and Cancel keeps the file open', async () => {
		await mount()
		await edit('two')
		await act(async () => void useFilesStore.getState().setViewerItem(null))
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a.txt')

		await click('cancel')
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a.txt')
		expect(document.querySelector('[aria-label="files-viewer.unsaved-changes"]')).not.toBeNull()
	})

	test('a change that lands while the viewer fades out brings it back behind the prompt, still closable', async () => {
		await mount()
		// Escape starts closing the clean viewer; the change comes in before it has gone
		await act(async () => {
			document.activeElement!.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}),
			)
			editor.edit!('two')
		})
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(button('files-viewer.dont-save')).toBeTruthy()
		expect(closeButton().parentElement!.className).not.toContain('animate-out')

		await click('cancel')
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a.txt')
		await key({key: 'Escape'})
		await click('files-viewer.dont-save')
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(useFilesStore.getState().viewerItem).toBeNull()
	})

	test('leaving for a folder (a search result) asks first, then goes there once the changes are discarded', async () => {
		const router = await mount()
		await edit('two')
		const leave = () => {
			useFilesStore.getState().setViewerItem(null)
			void router.navigate('/files/Home/Other')
		}
		await act(async () => useFilesStore.getState().leaveViewer(leave))
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a.txt')
		expect(router.state.location.pathname).toBe('/files/Home')

		await click('files-viewer.dont-save')
		expect(useFilesStore.getState().viewerItem).toBeNull()
		expect(router.state.location.pathname).toBe('/files/Home/Other')
		expect(uploads).toEqual([])
	})

	test('leaving Files asks first, and Don\u2019t Save lets the route through', async () => {
		const router = await mount()
		await edit('two')
		await act(async () => void router.navigate('/settings'))
		expect(router.state.location.pathname).toBe('/files/Home')

		await click('files-viewer.dont-save')
		expect(router.state.location.pathname).toBe('/settings')
		expect(uploads).toEqual([])
	})

	test('a failed save keeps the user where they were', async () => {
		respond = () => ({status: 500})
		await mount()
		await edit('two')
		await key({key: 'Escape'})
		await click('files-viewer.save')

		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a.txt')
		expect(button('files-viewer.save-failed')).toBeTruthy()
	})

	test('Escape goes to the viewer first, and closes only when the viewer has nothing to unwind', async () => {
		await mount()
		editor.escape = true
		await key({key: 'Escape'})
		expect(useFilesStore.getState().viewerItem).not.toBeNull()

		editor.escape = false
		await key({key: 'Escape'})
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(useFilesStore.getState().viewerItem).toBeNull()
	})

	test('Escape in a text field leaves the field first, then closes the viewer', async () => {
		await mount()
		const field = document.querySelector<HTMLInputElement>('input[aria-label="field"]')!
		await act(async () => field.focus())
		await key({key: 'Escape'})
		expect(document.activeElement).not.toBe(field)
		expect(useFilesStore.getState().viewerItem).not.toBeNull()

		await key({key: 'Escape'})
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(useFilesStore.getState().viewerItem).toBeNull()
	})

	const fileElement = () => document.querySelector<HTMLElement>('[data-testid="document"]')!
	const closeButton = () => document.querySelector<HTMLButtonElement>('header button[aria-label="close"]')!

	test('a text field’s Escape hands the keyboard back to the file', async () => {
		await mount()
		await act(async () => fileElement().focus())
		await act(async () => document.querySelector<HTMLInputElement>('input[aria-label="field"]')!.focus())
		await key({key: 'Escape'})
		expect(document.activeElement).toBe(fileElement())
	})

	test('a text field’s Escape hands the keyboard to the new file when what last had it went with the file before', async () => {
		await mount()
		await act(async () => fileElement().focus())
		await act(async () => void useFilesStore.getState().setViewerItem(file('/Home/b.txt'), 'open'))
		const field = document.querySelector<HTMLInputElement>('input[aria-label="field"]')!
		await act(async () => field.focus())
		await key({key: 'Escape'})
		expect(document.activeElement).toBe(fileElement())
	})

	test('Cancel hands the keyboard to the new file when what last had it went with the file before', async () => {
		await mount()
		await act(async () => fileElement().focus())
		await act(async () => void useFilesStore.getState().setViewerItem(file('/Home/b.txt'), 'open'))
		await edit('two')
		await act(async () => closeButton().click())
		await click('cancel')
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(document.activeElement).toBe(fileElement())
	})

	test('Cancel hands the keyboard back to the file, not to the Close button that asked', async () => {
		await mount()
		await edit('two')
		await act(async () => fileElement().focus())
		// As Chrome does for a button clicked
		await act(async () => closeButton().focus())
		await act(async () => closeButton().click())
		await click('cancel')
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(document.activeElement).toBe(fileElement())
	})

	// Until the upload is let go
	const held = () => {
		let release!: () => void
		hold = new Promise((resolve) => (release = resolve))
		return async () => {
			await act(async () => release())
			await act(async () => {})
		}
	}
	const sealed = () => document.querySelector('main')!.hasAttribute('inert')

	test('the file takes nothing in while the save that closes it lands, and has the keyboard back if it fails', async () => {
		respond = () => ({status: 500})
		await mount()
		await act(async () => fileElement().focus())
		await edit('two')
		await key({key: 'Escape'})
		const release = held()
		await click('files-viewer.save')
		expect(sealed()).toBe(true)
		// As the browser does with the keyboard of an element made inert
		await act(async () => (document.activeElement as HTMLElement).blur())

		await release()
		expect(sealed()).toBe(false)
		expect(document.activeElement).toBe(fileElement())
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a.txt')
	})

	test('the file takes nothing in while its copy is saved, and the copy then carries on', async () => {
		respond = (upload) => (upload.ifMatch ? {status: 412} : {status: 200, etag: '"c1"', path: '/Home/a (2).txt'})
		await mount()
		await edit('two')
		await key({key: 's', metaKey: true})
		const release = held()
		await click('files-viewer.save-copy')
		expect(sealed()).toBe(true)

		await release()
		expect(useFilesStore.getState().viewerItem?.path).toBe('/Home/a (2).txt')
		expect(sealed()).toBe(false)
	})

	test('a press on the chrome leaves the keyboard where it was; one in the file is the file’s', async () => {
		await mount()
		const press = (target: Element) => {
			const event = new MouseEvent('mousedown', {bubbles: true, cancelable: true})
			act(() => void target.dispatchEvent(event))
			return event.defaultPrevented
		}
		expect(press(closeButton())).toBe(true)
		expect(press(document.querySelector('input[aria-label="field"]')!)).toBe(false)
	})
})
