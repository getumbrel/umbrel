// The server's socket takes messages of up to 1 MiB (umbreld's
// MAX_WEBSOCKET_PAYLOAD_BYTES) and closes on a larger one: every live
// subscription goes with it, and the change that was too large is never
// made. Almost nothing comes near that. A change that names thousands of
// things does: everything in a Photos view favorited or deleted at once is
// twenty thousand ids, 1.4 MB. Those go over HTTP, which takes them whole.
//
// Counted in characters, and well short of the limit, as a character can be
// several bytes on the wire (file names, album names).
const SOCKET_INPUT_MAX_CHARS = 256 * 1024

export function isTooLargeForSocket(operation: {type: string; input: unknown}) {
	if (operation.type !== 'mutation' || operation.input === undefined) return false
	try {
		return JSON.stringify(operation.input).length > SOCKET_INPUT_MAX_CHARS
	} catch {
		// Not something sent as JSON: left to the link it has always gone by
		return false
	}
}
