import {useEffect, useState} from 'react'

import type {FileSystemItem} from '@/features/files/types'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

export const fileViewUrl = (path: string) => `/api/files/view?path=${encodeURIComponent(path)}`

// Reads [start, end) of the file at `url` with an HTTP Range request, for a
// viewer that needs only parts of a large file (a ZIP's directory, one entry)
export const rangeReader =
	(url: string, signal: AbortSignal) =>
	async (start: number, end: number): Promise<Uint8Array> => {
		const response = await fetch(url, {headers: {Range: `bytes=${start}-${end - 1}`}, signal})
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
	const url = useAuthorizedHttpUrlQuery(fileViewUrl(item.path))
	const [attempt, setAttempt] = useState(0)
	const [result, setResult] = useState<{key: string; bytes: FileBytes<unknown>}>()
	const key = `${url.url}#${attempt}`

	useEffect(() => {
		if (url.status !== 'ready') return
		const controller = new AbortController()
		const settle = (bytes: FileBytes<unknown>) => !controller.signal.aborted && setResult({key, bytes})
		const retry = () => setAttempt((count) => count + 1)
		fetch(url.url, {signal: controller.signal})
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
