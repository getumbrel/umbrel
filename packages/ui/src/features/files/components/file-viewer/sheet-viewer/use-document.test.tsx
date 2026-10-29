// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, expect, test, vi} from 'vitest'

import {useDocument} from './use-document'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => void vi.useRealTimers())

test('an open still under way when its document is let go is stopped', async () => {
	vi.useFakeTimers()
	let signal: AbortSignal | undefined
	const open = (_bytes: ArrayBuffer, given: AbortSignal) => {
		signal = given
		return new Promise<{dispose(): void}>(() => {})
	}
	function Viewer({bytes}: {bytes: ArrayBuffer}) {
		useDocument(bytes, open)
		return null
	}
	const root = createRoot(document.createElement('div'))
	await act(async () => root.render(<Viewer bytes={new ArrayBuffer(8)} />))
	expect(signal?.aborted).toBe(false)
	await act(async () => root.unmount())
	// It's let go a moment later, unless a viewer takes it up again (StrictMode's rehearsal)
	await act(async () => void vi.advanceTimersByTime(1000))
	expect(signal?.aborted).toBe(true)
})
