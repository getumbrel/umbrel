import type net from 'node:net'

type Write = (...args: any[]) => void

// Node destroys a socket as soon as a write to it fails, and with it anything
// the peer sent that hasn't been read yet. A server that answers a request
// before reading all of it and then closes makes a write fail that way, as the
// kernel resets the connection when more of the request arrives, so its answer
// is lost. Report such a write as done instead and leave it to the read side,
// which yields what the peer sent before coming to the end of the stream.
//
// Node has no option for this, so it wraps _write() and _writev(), the hooks
// through which the stream machinery hands a socket its data. It is only for
// plain TCP sockets: a TLS socket completes no further writes after one fails,
// so it would never finish closing.
export default function readBeforeFailedWrite(socket: net.Socket) {
	for (const method of ['_write', '_writev'] as const) {
		const write = socket[method] as Write
		socket[method] = (...args: any[]) => {
			const callback = args.pop()
			write.call(socket, ...args, (error?: NodeJS.ErrnoException | null) =>
				callback(error?.code === 'EPIPE' || error?.code === 'ECONNRESET' ? null : error),
			)
		}
	}
}
