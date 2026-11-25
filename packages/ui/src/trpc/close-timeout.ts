// How long a socket that was asked to close waits for the server to close its end
const CLOSE_TIMEOUT_MS = 2_000

/**
 * A WebSocket that doesn't wait long for the server to answer its close.
 *
 * tRPC closes a socket whose ping got no pong, which is how it finds a connection that died
 * without a word, but it replaces the socket only once the browser says it has closed. The
 * browser waits for the server to answer the close first, and Chrome gives a server that is no
 * longer there a minute. For that minute the requests sent over the dead socket hang, and no
 * events arrive.
 *
 * This socket says it has closed after two seconds without an answer, and keeps what the
 * connection it gave up on does afterwards to itself.
 */
export class WebSocketWithCloseTimeout extends WebSocket {
	#gaveUp = false

	constructor(url: string | URL, protocols?: string | string[]) {
		super(url, protocols)
		// Listeners run in the order they were added, so these run before anyone else's
		for (const type of ['error', 'close']) {
			this.addEventListener(type, (event) => {
				if (this.#gaveUp) event.stopImmediatePropagation()
			})
		}
	}

	close(code?: number, reason?: string) {
		super.close(code, reason)
		setTimeout(() => {
			if (this.readyState === WebSocket.CLOSED || this.#gaveUp) return
			// 1006 is the code a browser gives a connection that ended without a closing handshake
			this.dispatchEvent(new CloseEvent('close', {code: 1006}))
			this.#gaveUp = true
		}, CLOSE_TIMEOUT_MS)
	}
}
