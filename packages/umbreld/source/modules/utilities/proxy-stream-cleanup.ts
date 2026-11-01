import type {ClientRequest, IncomingMessage, ServerResponse} from 'node:http'

// http-proxy pipes the upstream response to the client, but pipe() does not
// cancel its source when the destination closes. Bind before response headers
// arrive so a completed GET can also be cancelled while waiting for upstream.
export default function proxyStreamCleanup(upstreamRequest: ClientRequest, downstreamResponse: ServerResponse) {
	let upstreamResponse: IncomingMessage | undefined
	const cleanup = () => {
		downstreamResponse.off('close', onDownstreamClose)
		upstreamRequest.off('response', onUpstreamResponse)
		upstreamRequest.off('error', cleanup)
	}
	const onDownstreamClose = () => {
		if (!downstreamResponse.writableFinished) {
			upstreamResponse?.destroy()
			upstreamRequest.destroy()
		}
		cleanup()
	}
	const onUpstreamResponse = (response: IncomingMessage) => {
		upstreamResponse = response
		// A truncated upstream response must not leave its client waiting, or
		// emit an unhandled response error when cancellation destroys the stream.
		response.once('error', () => downstreamResponse.destroy())
		response.once('close', cleanup)
		if (downstreamResponse.destroyed) onDownstreamClose()
	}
	upstreamRequest.once('response', onUpstreamResponse)
	upstreamRequest.once('error', cleanup)
	downstreamResponse.once('close', onDownstreamClose)
	if (downstreamResponse.destroyed) onDownstreamClose()
}
