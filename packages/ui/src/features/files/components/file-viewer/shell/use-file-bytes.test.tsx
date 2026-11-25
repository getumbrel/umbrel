// @vitest-environment jsdom

import {Blob as NodeBlob} from 'node:buffer'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {
	fileSource,
	FileSourceContext,
	rangeReader,
	useFileBytes,
	useFileDownloadUrl,
	useFileUrl,
	type FileBytes,
	type FileSource,
} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import type {FileSystemItem} from '@/features/files/types'

vi.mock('@/modules/auth/http-auth', () => ({
	useAuthorizedHttpUrl: (url?: string) => url,
	useAuthorizedHttpUrlQuery: (url: string) => ({status: 'ready', url, retry: () => {}}),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const item = {
	name: 'notes.txt',
	path: '/Home/notes.txt',
	type: 'text/plain',
	operations: [],
} as unknown as FileSystemItem

// Every state the hook has handed its viewer, the last one first
let seen: Array<FileBytes<unknown>>
function Bytes() {
	seen.unshift(useFileBytes(item))
	return null
}
function Read({read}: {read: (bytes: ArrayBuffer) => unknown}) {
	seen.unshift(useFileBytes(item, read))
	return null
}

let root: Root
beforeEach(() => {
	root = createRoot(document.createElement('div'))
	seen = []
})
afterEach(() => {
	act(() => root.unmount())
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

async function load(response: Response, read?: (bytes: ArrayBuffer) => unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => response),
	)
	await act(async () => root.render(read ? <Read read={read} /> : <Bytes />))
	return seen[0]
}

describe('useFileBytes', () => {
	test('hands over the bytes and their revision', async () => {
		const file = await load(new Response('hello', {headers: {ETag: '"r1"'}}))
		expect(file).toMatchObject({status: 'ready', revision: '"r1"'})
		expect(new TextDecoder().decode((file as {bytes: ArrayBuffer}).bytes)).toBe('hello')
	})

	test('a viewer that reads the bytes once is handed what it read, never the bytes', async () => {
		const read = vi.fn((bytes: ArrayBuffer) => new TextDecoder().decode(bytes).toUpperCase())
		expect(await load(new Response('hello', {headers: {ETag: '"r2"'}}), read)).toEqual({
			status: 'ready',
			bytes: 'HELLO',
			revision: '"r2"',
		})
		expect(read).toHaveBeenCalledTimes(1)
		expect(seen.some((state) => state.status === 'ready' && state.bytes instanceof ArrayBuffer)).toBe(false)
	})

	test('bytes the viewer can’t read make the file unreadable', async () => {
		const refuse = () => {
			throw new Error('Binary content')
		}
		expect(await load(new Response('\0\0'), refuse)).toMatchObject({status: 'error', error: 'unreadable'})
	})

	test('a missing file and a failing server are told apart', async () => {
		expect(await load(new Response('', {status: 404}))).toMatchObject({status: 'error', error: 'not-found'})
		act(() => root.unmount())
		root = createRoot(document.createElement('div'))
		expect(await load(new Response('', {status: 500}))).toMatchObject({status: 'error', error: 'unreachable'})
	})
})

describe('a file held in memory', () => {
	// jsdom's Blob can't be a Response's body, as a browser's can
	const source: FileSource = {blob: new NodeBlob(['hello']) as Blob, url: 'blob:test/1'}
	let urls: Array<{view: string | undefined; download: string | undefined}>
	function Urls() {
		urls.unshift({view: useFileUrl(item).url, download: useFileDownloadUrl(item)})
		return null
	}

	test('is read from its source, with no revision, and nothing is asked of the server', async () => {
		const fetch = vi.fn()
		vi.stubGlobal('fetch', fetch)
		await act(async () =>
			root.render(
				<FileSourceContext value={source}>
					<Bytes />
				</FileSourceContext>,
			),
		)
		// A blob comes out of its response a turn later than a string does
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(seen[0]).toMatchObject({status: 'ready', revision: undefined})
		expect(new TextDecoder().decode((seen[0] as {bytes: ArrayBuffer}).bytes)).toBe('hello')
		expect(fetch).not.toHaveBeenCalled()
	})

	test('is viewed and downloaded from its source’s URL, a file on disk from the server’s', async () => {
		urls = []
		await act(async () =>
			root.render(
				<FileSourceContext value={source}>
					<Urls />
				</FileSourceContext>,
			),
		)
		expect(urls[0]).toEqual({view: 'blob:test/1', download: 'blob:test/1'})
		await act(async () => root.render(<Urls />))
		expect(urls[0]).toEqual({
			view: '/api/files/view?path=%2FHome%2Fnotes.txt',
			download: '/api/files/download?path=%2FHome%2Fnotes.txt',
		})
	})

	test('has its ranges read from its blob, until a read is called off', async () => {
		const read = rangeReader(new Blob(['hello world']), new AbortController().signal)
		expect(new TextDecoder().decode(await read(6, 11))).toBe('world')
		await expect(read(0, 5, AbortSignal.abort())).rejects.toThrow()
	})

	test('is never typed as anything a browser would run script in, opened as a page', () => {
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test/1')
		const typed = (type: string) => fileSource(new Uint8Array(1), type).blob.type
		for (const type of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/xml', 'text/javascript'])
			expect(typed(type), type).toBe('application/octet-stream')
		for (const type of ['text/plain', 'application/pdf', 'image/png']) expect(typed(type)).toBe(type)
	})
})
