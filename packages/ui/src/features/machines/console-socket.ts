// A console opened elsewhere closes this one's socket with this code
export const SUPERSEDED_CLOSE_CODE = 4001

// Dropped sockets retry after 1 s, doubling to half a minute, so a tab left open
// on a dead connection (a sleeping laptop, a restarted umbrelOS) stays quiet
export const reconnectDelay = (attempt: number) => Math.min(1_000 * 2 ** attempt, 30_000)

export function machineSocketUrl(path: string, machineId: string, sessionId: string, ticket: string) {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const port = window.location.port ? `:${window.location.port}` : ''
	return `${protocol}//${window.location.hostname}${port}${path}?machineId=${encodeURIComponent(machineId)}&sessionId=${encodeURIComponent(sessionId)}&ticket=${encodeURIComponent(ticket)}`
}
