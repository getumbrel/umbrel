import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {ConnectionLostScreen} from '@/components/ui/connection-lost-screen'
import {Cover} from '@/components/ui/cover'
import {downloadLogs} from '@/utils/logs'

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	return String(error)
}

// Common error message patterns that indicate a network/connection failure rather than
// an application bug. These occur when a browser tab has been inactive —
// browsers throttle or kill idle connections, so background fetches and WebSocket
// reconnections fail silently. When the user returns to the tab, React tries to render
// with stale/failed data and throws. We detect these to show a "Connection lost"
// message instead of a scary "Something went wrong" nessage.
// Covers Chrome ("Failed to fetch"), Firefox ("NetworkError"), Safari ("Load failed"),
// and Node-style errors ("ECONNREFUSED"). Only messages containing these count: a bare "fetch" or
// "network" would also match real bugs (reading 'refetch', a network share error) and hide
// them behind a connection screen without the logs.
const NETWORK_ERROR_PATTERNS = ['Failed to fetch', 'NetworkError', 'Load failed', 'net::ERR_', 'ECONNREFUSED']

function isNetworkError(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase()
	return NETWORK_ERROR_PATTERNS.some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()))
}

// Last-resort error fallback rendered when all inner error boundaries fail.
// This is the outermost catch — it sits above every provider (trpc, wallpaper, router, etc.)
// so it can't rely on any of them. The UI is self-contained: no providers, no router, just
// plain React + Tailwind + i18n keys. Both covers are drawn in place (`standalone`), because the
// cover target went with the tree that failed.
//
// Two modes:
// - Network errors (failed to fetch, connection lost): Shows "Connection lost" with an
//   explanation. Most commonly triggered when a browser tab goes idle, the device restarts, or
//   the network drops. A single "Reconnect" button reloads the page.
// - Application errors (real bugs): Shows "Something went wrong" with "Reload" and "Download Logs".
//
// Both modes use the Page Visibility API to auto-reload when the user returns to the tab.
// This handles the most common scenario: user switches away, connection drops, they come back
export function RootErrorFallback({error}: {error: unknown}) {
	const {t} = useTranslation()
	const isNetwork = isNetworkError(error)

	// Auto-reload when the tab becomes visible again. Uses the Page Visibility API to detect
	// when users return to a stale/broken tab. This covers the most common failure mode:
	// browser throttles inactive tabs, killing fetch connections, and the user returns to
	// find an error screen. Full page reload (not resetErrorBoundary) because providers
	// and module state may be corrupted.
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				console.log('[RootErrorFallback] Tab became visible, reloading...')
				window.location.reload()
			}
		}
		document.addEventListener('visibilitychange', handleVisibilityChange)
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
	}, [])

	if (isNetwork) {
		return <ConnectionLostScreen error={error} onReconnect={() => window.location.reload()} />
	}

	return (
		<Cover
			standalone
			surface='black'
			mark='warning'
			// The string starts with a warning sign of its own, which the mark replaces
			title={t('something-went-wrong').replace(/^⚠\s*/, '')}
			actions={
				// Not the brand colour: the wallpaper provider sets it, and it isn't available at this level
				<>
					<Button size='dialog' variant='secondary' onClick={() => window.location.reload()}>
						{t('reload')}
					</Button>
					<Button size='dialog' variant='default' onClick={() => downloadLogs()}>
						{t('download-logs')}
					</Button>
				</>
			}
			details={error != null ? getErrorMessage(error) : undefined}
		/>
	)
}
