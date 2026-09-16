import net from 'node:net'

// Replay bytes consumed by classification before piping the rest.
export function forwardTcp(client: net.Socket, initial: Buffer[], port: number, release = () => {}) {
	client.setTimeout(0)
	const upstream = net.createConnection({host: '127.0.0.1', port})
	let finished = false
	const releaseInitial = () => {
		if (finished) return
		finished = true
		clearTimeout(handoffDeadline)
		initial = []
		release()
	}
	const destroyBoth = () => {
		releaseInitial()
		client.destroy()
		upstream.destroy()
	}
	// Bound connecting and flushing to a backend that is not reading.
	const handoffDeadline = setTimeout(destroyBoth, 5000)
	handoffDeadline.unref()
	client.on('error', destroyBoth)
	upstream.on('error', destroyBoth)
	// Cancellation must close both sockets; normal FINs must still flush queued writes.
	client.once('close', () => {
		if (upstream.connecting || !client.readableEnded || !client.writableFinished) destroyBoth()
		else {
			upstream.destroySoon()
		}
	})
	upstream.once('close', () => {
		releaseInitial()
		if (!upstream.readableEnded || !upstream.writableFinished) destroyBoth()
		else {
			client.destroySoon()
		}
	})
	upstream.pipe(client)
	for (const chunk of initial) upstream.write(chunk)
	// Hold the preread budget until all preceding writes have flushed upstream.
	upstream.write(Buffer.alloc(0), (error) => {
		if (error || client.destroyed || upstream.destroyed) return destroyBoth()
		releaseInitial()
		client.pipe(upstream)
	})
	return upstream
}
