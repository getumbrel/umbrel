import {useEffect, useState} from 'react'

type Disposable = {dispose(): void}

// Documents by the bytes they were opened from. The bytes move into the
// document's worker rather than being copied (a second copy of a big file is
// what an iPhone runs out of memory on), so a document outlives StrictMode's
// rehearsal unmount: it's let go a moment after the last viewer using it, and
// an open still under way then is stopped, rather than left to read the file
// to the end.
const documents = new WeakMap<
	ArrayBuffer,
	{opening: Promise<Disposable>; abort: AbortController; users: number; timer?: ReturnType<typeof setTimeout>}
>()

export function useDocument<D extends Disposable>(
	bytes: ArrayBuffer | undefined,
	open: (bytes: ArrayBuffer, signal: AbortSignal) => Promise<D>,
): {document: D} | {error: unknown} | undefined {
	const [result, setResult] = useState<{bytes: ArrayBuffer; outcome: {document: D} | {error: unknown}}>()
	useEffect(() => {
		if (!bytes) return
		let entry = documents.get(bytes)
		if (!entry) {
			const abort = new AbortController()
			entry = {opening: open(bytes, abort.signal), abort, users: 0}
			documents.set(bytes, entry)
		}
		const held = entry
		clearTimeout(held.timer)
		held.users++
		let current = true
		held.opening.then(
			(document) => current && setResult({bytes, outcome: {document: document as D}}),
			(error: unknown) => current && setResult({bytes, outcome: {error}}),
		)
		return () => {
			current = false
			if (--held.users > 0) return
			held.timer = setTimeout(() => {
				documents.delete(bytes)
				held.abort.abort()
				held.opening.then(
					(document) => document.dispose(),
					() => {},
				)
			}, 1000)
		}
		// `open` is read once per file
	}, [bytes])
	return bytes && result?.bytes === bytes ? result.outcome : undefined
}
