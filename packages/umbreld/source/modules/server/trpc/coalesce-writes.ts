import type {Socket} from 'node:net'

import type {WebSocket} from 'ws'

// Every tRPC message is its own WebSocket frame, and on a fast connection its
// own write syscall. A large burst of file events streams hundreds of
// thousands of messages to every open Files tab, so hold each connection's
// writes while a run of work sends them and flush them together once it ends.
// The flush runs on process.nextTick, which comes after the current run of
// promise callbacks, so a lone message still goes out straight away.
export function coalesceWrites(ws: WebSocket) {
	// ws doesn't expose its socket publicly. Without it, sends work as before.
	const socket = (ws as unknown as {_socket?: Socket})._socket
	if (typeof socket?.cork !== 'function') return
	const send = ws.send.bind(ws)
	let corked = false
	ws.send = ((...args: Parameters<WebSocket['send']>) => {
		if (!corked) {
			corked = true
			socket.cork()
			process.nextTick(() => {
				corked = false
				socket.uncork()
			})
		}
		return send(...args)
	}) as WebSocket['send']
}
