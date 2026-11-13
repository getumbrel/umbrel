// @vitest-environment jsdom

import {Blob as NodeBlob} from 'node:buffer'
import {TooltipProvider} from '@radix-ui/react-tooltip'
import {act, type ReactElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {createMemoryRouter, RouterProvider} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import ArchiveViewer from '@/features/files/components/file-viewer/archive-viewer'
import {zip} from '@/features/files/components/file-viewer/document-viewer/engine/test-helpers'
import {useViewerSave} from '@/features/files/components/file-viewer/shell/context'
import {QuickLook} from '@/features/files/components/file-viewer/shell/quick-look'
import {useFileBytes} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import {ViewerShell} from '@/features/files/components/file-viewer/shell/viewer-shell'
import type {Viewer, ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key, i18n: {language: 'en'}})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('motion/react', () => ({useReducedMotion: () => true}))
vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => false}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
vi.mock('@/hooks/use-language', () => ({useLanguage: () => ['en']}))
// jsdom lays nothing out: the listing is given room for its rows
vi.mock('@/hooks/use-container-size', () => ({useContainerSize: () => ({width: 800, height: 400})}))
vi.mock('@/providers/wallpaper', () => ({useWallpaper: () => ({wallpaper: {}}), WallpaperAvifSource: () => null}))
vi.mock('@/modules/auth/http-auth', () => ({
	useAuthorizedHttpUrl: (url?: string) => url,
	useAuthorizedHttpUrlQuery: (url?: string) => ({status: url ? 'ready' : 'idle', url, retry: () => {}}),
	dashboardAuthHeaders: () => ({}),
}))
vi.mock('@/features/files/hooks/use-files-operations', () => ({useFilesOperations: () => ({extractItems: vi.fn()})}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({files: {list: {invalidate: vi.fn()}}}),
		files: {pathOperations: {useQuery: () => ({data: ['writable']})}},
	},
}))
// The text viewer, as far as an entry needs it: the bytes it reads, and a change it would save if it could
vi.mock('@/features/files/components/file-viewer/text-viewer', () => ({default: FakeText}))
function FakeText({item}: ViewerProps) {
	const text = useFileBytes(item, (bytes) => new TextDecoder().decode(bytes))
	useViewerSave({revision: undefined, serialize: async () => new Blob(['changed']), onSaved: () => {}}, true)
	return (
		<p data-testid='text' data-writable={item.operations.includes('writable')}>
			{text.status === 'ready' ? text.bytes : text.status}
		</p>
	)
}
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// In a folder's order: broken.txt, clip.mp4, disk.dmg, inner.zip, notes.txt, padding.iso, paper.pdf, readme.md,
// song.mp3. The padding comes last, and is long enough that the archive's end, read to list it, holds no other file:
// those are read when they're asked for.
const bytes = zip(
	{
		'docs/guide.txt': 'guide',
		'notes.txt': 'hello',
		'paper.pdf': '%PDF-1.7',
		'readme.md': '# Read me',
		'song.mp3': 'mp3',
		'clip.mp4': 'mp4',
		'inner.zip': 'zip',
		'disk.dmg': 'dmg',
		'broken.txt': 'damaged!',
		'padding.iso': 'x'.repeat(70_000),
	},
	{deflate: ['notes.txt']},
)
// broken.txt's bytes no longer match its CRC
bytes[Buffer.from(bytes).indexOf('damaged!')] ^= 1
const archiveItem = {
	name: 'bundle.zip',
	path: '/Home/bundle.zip',
	type: 'application/zip',
	size: bytes.length,
	modified: 0,
	operations: ['unarchive'],
} as FileSystemItem
const archiveViewer: Viewer = {Component: ArchiveViewer, preload: async () => {}, ownsArrows: true}

let container: HTMLDivElement
let root: Root
const filesStep = vi.fn()
const fetches: Array<{url: string; method: string; signal?: AbortSignal | null}> = []
// Until it's let go, every read waits
let held: Promise<void> | undefined
let urls = 0
// What the browser was handed to download
const downloads: Array<{href: string; download: string}> = []

async function mount(element: ReactElement) {
	// jsdom's Blob can't be a Response's body, as a browser's can
	vi.stubGlobal('Blob', NodeBlob)
	urls = 0
	vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++urls}`)
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
		downloads.push({href: this.getAttribute('href')!, download: this.download})
	})
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			fetches.push({url, method: init?.method ?? 'GET', signal: init?.signal})
			await held
			init?.signal?.throwIfAborted()
			const [start, end] = new Headers(init?.headers).get('Range')!.slice(6).split('-').map(Number)
			return new Response(bytes.slice(start, end + 1), {status: 206})
		}),
	)
	useFilesStore.setState({
		viewerItem: archiveItem,
		viewerMode: 'open',
		viewerNavigationGuard: null,
		viewerStepper: {step: filesStep, canStep: () => true},
	})
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	const router = createMemoryRouter([{path: '*', element}], {initialEntries: ['/files/Home']})
	await act(async () =>
		root.render(
			<ImmersiveDialogProvider>
				<TooltipProvider>
					<RouterProvider router={router} />
				</TooltipProvider>
			</ImmersiveDialogProvider>,
		),
	)
	await settle()
}

afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	fetches.length = 0
	downloads.length = 0
	held = undefined
	filesStep.mockClear()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

const tick = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
// Until the archive's reads and its viewer's code have landed
const settle = async () => {
	for (let i = 0; i < 5; i++) await tick()
}
// Until what's opened is on the stage: inflating takes as long as it takes
const until = async (shown: () => unknown) => {
	for (let i = 0; i < 200 && !shown(); i++) await tick()
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
// Its accessible name: the file the stage shows
const title = () => document.getElementById(dialog().getAttribute('aria-labelledby')!)!.textContent
// A name in the listing, not the title's
const row = (name: string) =>
	[...dialog().querySelectorAll('span')].find((span) => span.textContent === name && !span.closest('header'))!
const rowButton = (name: string) => row(name).closest('button')
// As a press does, the keyboard goes to the row first
const open = async (name: string) => {
	await act(async () => {
		rowButton(name)!.focus()
		rowButton(name)!.click()
	})
	await until(() => read() || stageTitle())
}
const key = async (key: string, init: KeyboardEventInit = {}) => {
	const target = document.activeElement ?? document.body
	await act(
		async () =>
			void target.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...init})),
	)
	await settle()
}
const labelled = (label: string) => dialog().querySelector<HTMLElement>(`[aria-label="${label}"]`)
const press = async (element: HTMLElement | null | undefined) => {
	await act(async () => element!.click())
	await settle()
}
const text = () => document.querySelector<HTMLElement>('[data-testid="text"]')
// The text viewer once it has its bytes: it's up a turn before them, saying it's loading
const read = () => (text()?.textContent === 'loading' ? null : text())
const stageTitle = () => dialog().querySelector('main h3')?.textContent
const listing = () => row('notes.txt').closest('[inert]')

describe('An opened archive’s files', () => {
	beforeEach(() => mount(<ViewerShell item={archiveItem} viewer={archiveViewer} />))

	test('all open but those the archive can’t read, and no row’s button holds its download’s', () => {
		for (const name of ['notes.txt', 'readme.md', 'song.mp3', 'clip.mp4', 'inner.zip', 'disk.dmg', 'broken.txt']) {
			expect(rowButton(name), name).not.toBeNull()
			expect(rowButton(name)!.querySelector('button'), name).toBeNull()
		}
	})

	test('a row’s Download hands over the file from memory, typed as a download whatever it holds', async () => {
		await press(
			rowButton('notes.txt')!.parentElement!.querySelector<HTMLElement>('[aria-label="files-archive.download"]'),
		)
		await until(() => downloads.length)
		expect(downloads).toEqual([{href: 'blob:test/1', download: 'notes.txt'}])
		// Bytes with no type would leave a browser asked to open them to guess, and they have Umbrel's origin
		const [[blob]] = vi.mocked(URL.createObjectURL).mock.calls
		expect((blob as Blob).type).toBe('application/octet-stream')
	})

	test('one opens in the listing’s place from memory, under its own name, and is never saved', async () => {
		await open('notes.txt')
		expect(text()?.textContent).toBe('hello')
		expect(text()?.dataset.writable).toBe('false')
		expect(title()).toBe('notes.txt')
		expect(listing()).not.toBeNull()
		// Its viewer has a change to save, but the shell offers none, and ⌘S writes nothing
		expect([...dialog().querySelectorAll('button')].some((button) => button.textContent === 'files-viewer.save')).toBe(
			false,
		)
		await key('s', {metaKey: true})
		expect(fetches.every(({method}) => method === 'GET')).toBe(true)
		// What the server is asked for is only ever the archive's bytes
		expect(new Set(fetches.map(({url}) => url))).toEqual(new Set(['/api/files/view?path=%2FHome%2Fbundle.zip']))
	})

	test('the keyboard goes onto the file opened, out of the listing it leaves', async () => {
		await open('notes.txt')
		expect(document.activeElement?.contains(text())).toBe(true)
		expect(document.activeElement?.closest('[inert]')).toBeNull()
	})

	test('Download hands over the file from memory, under its name', async () => {
		await open('notes.txt')
		await press(labelled('files-viewer.download'))
		expect(downloads).toEqual([{href: 'blob:test/1', download: 'notes.txt'}])
	})

	test('back goes to the listing, with the keyboard on the file’s row, and lets the file go', async () => {
		await open('notes.txt')
		expect(labelled('files-viewer.back-to')).not.toBeNull()
		await press(labelled('files-viewer.back-to'))
		expect(text()).toBeNull()
		expect(title()).toBe('bundle.zip')
		expect(labelled('files-viewer.back-to')).toBeNull()
		expect(listing()).toBeNull()
		expect(document.activeElement).toBe(rowButton('notes.txt'))
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1')
	})

	test('Escape goes back to the listing before it closes the viewer', async () => {
		await open('notes.txt')
		await key('Escape')
		expect(text()).toBeNull()
		expect(useFilesStore.getState().viewerItem).not.toBeNull()
	})

	test('←/→ step through the folder’s files that open and leave them the arrows, not the folder’s around it', async () => {
		await open('notes.txt')
		// Past paper.pdf, whose pages take the arrows
		await key('ArrowRight')
		expect(text()?.textContent).toBe('# Read me')
		expect(title()).toBe('readme.md')
		await key('ArrowRight')
		expect(title()).toBe('readme.md')
		await key('ArrowLeft')
		expect(title()).toBe('notes.txt')
		expect(filesStep).not.toHaveBeenCalled()
	})

	test('back from a file stepped to, the keyboard is on that file’s row', async () => {
		await open('notes.txt')
		await key('ArrowRight')
		await key('Escape')
		expect(document.activeElement).toBe(rowButton('readme.md'))
	})

	test('stepping on lets go of a file still being read: it’s never shown, nor held', async () => {
		let release!: () => void
		held = new Promise((resolve) => (release = resolve))
		await open('notes.txt')
		await key('ArrowRight')
		await act(async () => release())
		await until(read)
		expect(text()?.textContent).toBe('# Read me')
		expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
		// Its read was called off, not just thrown away once done
		expect(fetches.some(({signal}) => signal?.aborted)).toBe(true)
	})

	test('one that can’t be opened here says so, and is read only to be downloaded', async () => {
		const reads = fetches.length
		await open('song.mp3')
		expect(title()).toBe('song.mp3')
		expect(stageTitle()).toBe('files-archive.unopenable-title')
		expect(fetches.length).toBe(reads)
		const download = [...dialog().querySelectorAll('main button')].find(
			(button) => button.textContent === 'files-viewer.download',
		)
		await press(download as HTMLElement)
		expect(fetches.length).toBeGreaterThan(reads)
		expect(downloads).toEqual([{href: 'blob:test/1', download: 'song.mp3'}])
		// One Files can’t open anywhere is said to be so
		await key('Escape')
		await open('disk.dmg')
		expect(stageTitle()).toBe('files-viewer.unsupported-title')
	})

	test('one that’s damaged offers the archive’s download, said to be the archive’s', async () => {
		await open('broken.txt')
		expect(stageTitle()).toBe('files-archive.damaged')
		const link = dialog().querySelector<HTMLAnchorElement>('main a[download]')!
		expect(link.download).toBe('bundle.zip')
		expect(link.getAttribute('href')).toBe('/api/files/download?path=%2FHome%2Fbundle.zip')
		expect(link.textContent).toBe('files-archive.download')
	})
})

describe('A quick look at an archive', () => {
	beforeEach(() => mount(<QuickLook item={archiveItem} viewer={archiveViewer} />))

	test('lists its files, but opens none', () => {
		expect(row('notes.txt')).toBeDefined()
		expect(rowButton('notes.txt')).toBeNull()
		expect(rowButton('docs')).not.toBeNull()
	})
})
