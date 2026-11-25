// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

const SECOND = 1000
const MINUTE = 60 * SECOND

// The browser's own socket, with the server at the other end of it. The server can stop
// answering, which is all a browser sees of a connection that died without a word.
class BrowserWebSocket extends EventTarget {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static readonly CLOSING = 2
	static readonly CLOSED = 3
	static serverAnswers = true
	static opened: BrowserWebSocket[] = []

	readyState = BrowserWebSocket.CONNECTING
	binaryType = 'blob'

	constructor(readonly url: string) {
		super()
		BrowserWebSocket.opened.push(this)
		setTimeout(() => {
			this.readyState = BrowserWebSocket.OPEN
			this.dispatchEvent(new Event('open'))
		})
	}

	send(data: string) {
		if (data !== 'PING' || !BrowserWebSocket.serverAnswers) return
		setTimeout(() => this.dispatchEvent(new MessageEvent('message', {data: 'PONG'})))
	}

	close() {
		this.readyState = BrowserWebSocket.CLOSING
		// A server that is there answers at once. Chrome waits a minute for one that isn't.
		const answered = BrowserWebSocket.serverAnswers
		setTimeout(
			() => {
				this.readyState = BrowserWebSocket.CLOSED
				this.dispatchEvent(new CloseEvent('close', {code: answered ? 1000 : 1006}))
			},
			answered ? 0 : MINUTE,
		)
	}
}

// The class under test extends whatever WebSocket is when it is loaded
vi.stubGlobal('WebSocket', BrowserWebSocket)
const {WebSocketWithCloseTimeout} = await import('./close-timeout')
const {createWSClient} = await import('@trpc/client')

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

// The app's settings (trpc.ts): a ping every 10 seconds, 3 seconds for the pong
const keepAlive = {enabled: true, intervalMs: 10 * SECOND, pongTimeoutMs: 3 * SECOND}

describe('WebSocketWithCloseTimeout', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		BrowserWebSocket.serverAnswers = true
		BrowserWebSocket.opened = []
	})

	afterEach(() => vi.useRealTimers())

	test('has tRPC replace a silent connection 5 seconds after pinging it, and only once', async () => {
		createWSClient({url: 'ws://umbrel.local/trpc', WebSocket: WebSocketWithCloseTimeout, keepAlive})
		await advance(0)
		expect(BrowserWebSocket.opened).toHaveLength(1)

		// The ping is sent after 10 seconds, and gets no pong
		BrowserWebSocket.serverAnswers = false
		await advance(10 * SECOND + 5 * SECOND - 1)
		expect(BrowserWebSocket.opened).toHaveLength(1)

		await advance(SECOND)
		expect(BrowserWebSocket.opened).toHaveLength(2)

		// The new connection works. A minute after the close, the browser gives up on the old one
		// and says so, which tRPC would take for a reason to reconnect again.
		BrowserWebSocket.serverAnswers = true
		await advance(2 * MINUTE)
		expect(BrowserWebSocket.opened[0].readyState).toBe(WebSocket.CLOSED)
		expect(BrowserWebSocket.opened).toHaveLength(2)
	})

	// Why the class exists. If this fails, tRPC has stopped waiting for the browser and the class can go.
	test('tRPC by itself waits for the browser, which takes a minute longer', async () => {
		createWSClient({url: 'ws://umbrel.local/trpc', WebSocket: WebSocket, keepAlive})
		await advance(0)

		BrowserWebSocket.serverAnswers = false
		await advance(10 * SECOND + 3 * SECOND + MINUTE - 1)
		expect(BrowserWebSocket.opened).toHaveLength(1)

		await advance(SECOND)
		expect(BrowserWebSocket.opened).toHaveLength(2)
	})

	test('leaves a close that the server answers to the browser', async () => {
		const socket = new WebSocketWithCloseTimeout('ws://umbrel.local/trpc')
		const closes: number[] = []
		socket.addEventListener('close', (event) => closes.push(event.code))
		await advance(0)

		socket.close()
		await advance(0)
		expect(closes).toEqual([1000])

		await advance(MINUTE)
		expect(closes).toEqual([1000])
	})
})
