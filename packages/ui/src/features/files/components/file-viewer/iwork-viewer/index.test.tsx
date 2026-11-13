// @vitest-environment jsdom
import {Blob as NodeBlob} from 'node:buffer'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, expect, test, vi} from 'vitest'

import {zip} from '@/features/files/components/file-viewer/document-viewer/engine/test-helpers'
import IworkViewer from '@/features/files/components/file-viewer/iwork-viewer'
import type {FileSystemItem} from '@/features/files/types'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/modules/auth/http-auth', () => ({
	useAuthorizedHttpUrl: (url?: string) => url,
	useAuthorizedHttpUrlQuery: (url?: string) => ({status: url ? 'ready' : 'idle', url, retry: () => {}}),
	dashboardAuthHeaders: () => ({}),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
// The bytes each read of the package asked for
const reads: Array<[start: number, end: number]> = []

// The viewer over a package, once its reads have landed
async function open(bytes: Uint8Array) {
	// jsdom's Blob can't be a Response's body, as a browser's can
	vi.stubGlobal('Blob', NodeBlob)
	vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test/preview')
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init?: RequestInit) => {
			const [start, end] = new Headers(init?.headers).get('Range')!.slice(6).split('-').map(Number)
			reads.push([start, end])
			return new Response(bytes.slice(start, end + 1), {status: 206})
		}),
	)
	const item = {
		name: 'letter.pages',
		path: '/Home/letter.pages',
		type: 'application/vnd.apple.pages',
		size: bytes.length,
		modified: 0,
		operations: [],
	} as FileSystemItem
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () => root.render(<IworkViewer item={item} mode='open' />))
	for (let turn = 0; turn < 20; turn++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	reads.length = 0
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

test('a package’s preview is read out of it and shown', async () => {
	await open(zip({'Index/Document.iwa': 'x'.repeat(100_000), 'preview.jpg': 'a small picture'}))
	expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test/preview')
	const [[preview]] = vi.mocked(URL.createObjectURL).mock.calls
	expect(await (preview as Blob).text()).toBe('a small picture')
})

test('a preview that would unpack to far more than any real one is never read: the file is said to have none', async () => {
	// 33 MB of nothing, in a package of a few kilobytes
	const bytes = zip({'preview.jpg': new Uint8Array(33 * 2 ** 20)}, {deflate: ['preview.jpg']})
	expect(bytes.length).toBeLessThan(100_000)
	await open(bytes)
	expect(container.textContent).toContain('files-iwork.no-preview-title')
	expect(container.querySelector('img')).toBeNull()
	expect(URL.createObjectURL).not.toHaveBeenCalled()
	// Only the package's end, where its directory is, was read
	expect(reads).toHaveLength(1)
})
