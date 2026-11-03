// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, describe, expect, test, vi} from 'vitest'

import {isTextHead, useStartsAsText} from '@/features/files/components/file-viewer/text-viewer'
import type {FileSystemItem} from '@/features/files/types'

vi.mock('@/modules/auth/http-auth', () => ({
	useAuthorizedHttpUrl: (url?: string) => url,
	useAuthorizedHttpUrlQuery: (url?: string) => (url ? {status: 'ready', url} : {status: 'idle', url: undefined}),
}))
vi.mock('@/trpc/trpc', () => ({trpcReact: {}}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => vi.unstubAllGlobals())

const bytes = (...values: number[]) => new Uint8Array(values).buffer
// The start of an ELF binary: valid UTF-8, NUL bytes and all
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00)

describe('isTextHead', () => {
	test('UTF-8 text is text, though the cut splits its last character', () => {
		const text = new TextEncoder().encode('FROM node:22\n# café')
		expect(isTextHead(text.slice(0, -1).buffer)).toBe(true)
		expect(isTextHead(new ArrayBuffer(0))).toBe(true)
	})

	test('bytes that aren’t UTF-8, NUL bytes and runs of control characters aren’t', () => {
		// An MPEG transport stream's first packet
		expect(isTextHead(bytes(0x47, 0x40, 0x11, 0x10, 0x00, 0x42, 0xf0, 0x25))).toBe(false)
		expect(isTextHead(ELF)).toBe(false)
		expect(isTextHead(new TextEncoder().encode('\x01\x02\x03\x04 abc').buffer)).toBe(false)
	})
})

describe('useStartsAsText', () => {
	const file = (type: string, name = 'file') =>
		({name, path: `/Home/${name}`, type, operations: []}) as unknown as FileSystemItem

	// Every answer the hook gave, the last one first, and the requests it made
	async function look(type: string, respond: () => Promise<Response>, name?: string) {
		const fetch = vi.fn<typeof globalThis.fetch>(respond)
		vi.stubGlobal('fetch', fetch)
		const seen: Array<boolean | undefined> = []
		function Look() {
			seen.unshift(useStartsAsText(file(type, name)))
			return null
		}
		const root = createRoot(document.createElement('div'))
		await act(async () => root.render(<Look />))
		act(() => root.unmount())
		return {seen, fetch}
	}

	test('a file whose type says it’s text is taken at its word, unread', async () => {
		const {seen, fetch} = await look('text/plain', async () => new Response('hello'))
		expect(seen).toEqual([true])
		expect(fetch).not.toHaveBeenCalled()
	})

	test('a file of an uncertain type is told by its start, which is all that’s read', async () => {
		const binary = await look('application/octet-stream', async () => new Response(ELF, {status: 206}))
		expect([binary.seen[0], binary.seen.at(-1)]).toEqual([false, undefined])
		expect(binary.fetch).toHaveBeenCalledOnce()
		expect(binary.fetch.mock.calls[0][1]).toMatchObject({headers: {Range: 'bytes=0-4095'}})

		const text = await look(
			'video/mp2t',
			async () => new Response('export const answer = 42', {status: 206}),
			'answer.ts',
		)
		expect(text.seen[0]).toBe(true)
	})

	test('a start that can’t be read leaves the file to the editor, which says why', async () => {
		// An empty file has no range to send; one gone, or a server out of reach, is the editor's to tell
		for (const respond of [
			async () => new Response('', {status: 416}),
			async () => new Response('', {status: 404}),
			async () => Promise.reject(new TypeError('Failed to fetch')),
		]) {
			const {seen} = await look('application/octet-stream', respond)
			expect(seen[0]).toBe(true)
		}
	})
})
