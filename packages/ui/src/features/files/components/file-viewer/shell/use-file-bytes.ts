import {createContext, useContext, useEffect, useState} from 'react'

import type {FileSystemItem} from '@/features/files/types'
import {useAuthorizedHttpUrl, useAuthorizedHttpUrlQuery, type AuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

export const fileViewUrl = (path: string) => `/api/files/view?path=${encodeURIComponent(path)}`

// A file held in memory rather than on the server (an archive's entry, opened): its viewer reads it from here,
// through the hooks below, and asks the server nothing about it. The page may not fetch an object URL (its Content
// Security Policy), so the URL is only for what the browser loads itself (a picture, a download), and reads go to
// the blob.
export type FileSource = {blob: Blob; url: string}
export const FileSourceContext = createContext<FileSource | null>(null)
export const useFileSource = () => useContext(FileSourceContext)

// Types a browser only ever shows, never runs script in, were the URL opened as a page: those of umbreld's
// (inlineViewMimeTypes) that an entry is opened as. An object URL has our origin, so anything else is held as bytes
// to download, as umbreld serves it.
const INLINE_TYPES = new Set([
	'text/plain',
	'application/pdf',
	'image/avif',
	'image/bmp',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/vnd.microsoft.icon',
	'image/webp',
	'video/mp4',
	'video/mpeg',
	'video/ogg',
	'video/quicktime',
	'video/webm',
	'video/x-m4v',
])

// A file's bytes, of the type given, as a source to read it from. Its URL is the caller's to revoke.
export function fileSource(bytes: Uint8Array<ArrayBuffer>, type: string): FileSource {
	const blob = new Blob([bytes], {type: INLINE_TYPES.has(type) ? type : 'application/octet-stream'})
	return {blob, url: URL.createObjectURL(blob)}
}

// Where the file is read from: its source's URL, or the server's once it's authorized. Undefined asks for nothing.
export function useFileUrl(item: FileSystemItem | undefined): AuthorizedHttpUrlQuery {
	const source = useFileSource()
	const server = useAuthorizedHttpUrlQuery(item && !source ? fileViewUrl(item.path) : undefined)
	return item && source ? {...server, status: 'ready', url: source.url} : server
}

// The file's download link: its source's, or the server's
export function useFileDownloadUrl(item: FileSystemItem) {
	const source = useFileSource()
	const server = useAuthorizedHttpUrl(source ? undefined : `/api/files/download?path=${encodeURIComponent(item.path)}`)
	return source?.url ?? server
}

// Reads [start, end) of the file at `url` with an HTTP Range request, for a
// viewer that needs only parts of a large file (a ZIP's directory, one entry),
// or of the blob a source holds it in. A read stops with `signal`, or with a
// signal of its own, which must stop it no later than `signal` would.
export const rangeReader =
	(file: string | Blob, signal: AbortSignal) =>
	async (start: number, end: number, stop = signal): Promise<Uint8Array> => {
		if (file instanceof Blob) {
			const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer())
			stop.throwIfAborted()
			return bytes
		}
		const response = await fetch(file, {headers: {Range: `bytes=${start}-${end - 1}`}, signal: stop})
		if (response.status !== 206) throw new Error(`Range request answered ${response.status}`)
		return new Uint8Array(await response.arrayBuffer())
	}

export type FileBytes<T = ArrayBuffer> =
	| {status: 'loading'}
	| {status: 'ready'; bytes: T; revision: string | undefined}
	| {status: 'error'; error: 'not-found' | 'unreachable' | 'unreadable'; retry: () => void}

// The file as the server holds it now, and the revision those bytes are (the
// ETag) — what a later save is checked against. A viewer that reads the bytes
// only once passes `read`, and is handed what it made of them instead, so the
// download isn't kept as well (a throw makes the file unreadable). A response
// for a file no longer asked for is dropped, and its download aborted.
export function useFileBytes(item: FileSystemItem): FileBytes
export function useFileBytes<T>(item: FileSystemItem, read: (bytes: ArrayBuffer) => T): FileBytes<T>
export function useFileBytes(item: FileSystemItem, read = (bytes: ArrayBuffer): unknown => bytes): FileBytes<unknown> {
	const source = useFileSource()
	const url = useFileUrl(item)
	const [attempt, setAttempt] = useState(0)
	const [result, setResult] = useState<{key: string; bytes: FileBytes<unknown>}>()
	const key = `${url.url}#${attempt}`

	useEffect(() => {
		if (url.status !== 'ready') return
		const controller = new AbortController()
		const settle = (bytes: FileBytes<unknown>) => !controller.signal.aborted && setResult({key, bytes})
		const retry = () => setAttempt((count) => count + 1)
		// A source's blob is read as the server's answer would be, with no revision: it's never saved
		;(source ? Promise.resolve(new Response(source.blob)) : fetch(url.url, {signal: controller.signal}))
			.then(async (response) => {
				if (!response.ok)
					return settle({status: 'error', error: response.status === 404 ? 'not-found' : 'unreachable', retry})
				const bytes = await response.arrayBuffer()
				const revision = response.headers.get('ETag') ?? undefined
				try {
					settle({status: 'ready', bytes: read(bytes), revision})
				} catch {
					settle({status: 'error', error: 'unreadable', retry})
				}
			})
			.catch(() => settle({status: 'error', error: 'unreachable', retry}))
		return () => controller.abort()
	}, [key, url.status, url.url])

	if (url.status === 'error') return {status: 'error', error: 'unreachable', retry: url.retry}
	return result?.key === key ? result.bytes : {status: 'loading'}
}
