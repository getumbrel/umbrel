import type {RouterError} from '@/trpc/trpc'

// tRPC wraps every failure in a TRPCClientError, but only a failure the server actually
// answered carries `shape` (the parsed error response). A request that never got a
// response — connection refused while the device reboots, an idle connection the browser
// killed, DNS — is a bare wrapper around fetch()'s TypeError, whose message is browser
// specific: Chrome says "Failed to fetch", Firefox "NetworkError when attempting to fetch
// resource.", Safari "Load failed", Node "fetch failed". Matching on those strings is what
// let Safari and Firefox slip through, so classify by structure instead.
export function isTransportError(error: Pick<RouterError, 'shape'> | null | undefined): boolean {
	return error != null && error.shape == null
}
