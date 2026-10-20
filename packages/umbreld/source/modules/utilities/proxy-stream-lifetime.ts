import type http from 'node:http'

// http-proxy only cancels the upstream request when the client request emits
// 'aborted', which Node doesn't emit once the request body has been read, and
// never tells the client when the upstream response is cut short. So a client
// that goes away (a cancelled download, a video seek, a laptop going to sleep)
// leaves the upstream request and its buffered response held forever, and a
// client whose upstream dies part way through a response waits forever. These
// hooks tie each side's lifetime to the other.

// Use as onProxyReq. Covers the whole exchange, including an upstream that
// never replies.
export function releaseUpstreamOnClientClose(upstream: {destroy(): unknown}, response: http.ServerResponse) {
	const release = () => {
		if (!response.writableFinished) upstream.destroy()
	}
	if (response.destroyed) return release()
	response.once('close', release)
}

// Use as onProxyRes.
export function closeClientOnUpstreamAbort(
	proxyResponse: http.IncomingMessage,
	request: http.IncomingMessage,
	response: http.ServerResponse,
) {
	// http-proxy skips onProxyReq for requests with an Expect header, so release
	// their upstream from here once it replies.
	if (request.headers.expect) releaseUpstreamOnClientClose(proxyResponse, response)
	proxyResponse.once('close', () => {
		if (!proxyResponse.complete) response.destroy()
	})
}
