// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useFileBytes, type FileBytes} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import type {FileSystemItem} from '@/features/files/types'

vi.mock('@/modules/auth/http-auth', () => ({
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
