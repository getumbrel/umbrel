import {ChevronDown, ChevronUp} from 'lucide-react'
import {useEffect, useState} from 'react'

import {Button} from '@/components/ui/button'
import {t} from '@/utils/i18n'
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
// and Node-style errors ("ECONNREFUSED").
const NETWORK_ERROR_PATTERNS = [
	'Failed to fetch',
	'NetworkError',
	'Load failed',
	'net::ERR_',
	'fetch',
	'network',
	'ECONNREFUSED',
]

function isNetworkError(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase()
	return NETWORK_ERROR_PATTERNS.some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()))
}

// Last-resort error fallback rendered when all inner error boundaries fail.
// This is the outermost catch — it sits above every provider (trpc, wallpaper, router, etc.)
// so it can't rely on any of them. The UI is self-contained: no providers, no router, just
// plain React + Tailwind + i18n keys.
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
	const [showDetails, setShowDetails] = useState(false)
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

	return (
		<div className='fixed inset-0 z-50 flex items-center justify-center bg-black'>
			{/* Self-contained dialog card — mirrors AlertDialogContent styling but without
			    depending on Radix or any providers. Uses the same design tokens (rounded-20,
			    bg-dialog-content, shadow-dialog, backdrop-blur) for visual consistency. */}
			<div className='flex w-full max-w-[calc(100%-40px)] flex-col items-center gap-5 rounded-20 bg-dialog-content/70 p-8 shadow-dialog backdrop-blur-3xl sm:max-w-md'>
				<div className='flex flex-col items-center gap-1.5'>
					<h2 className='text-15 leading-tight font-semibold -tracking-4'>
						{isNetwork ? t('connection-lost') : t('something-went-wrong')}
					</h2>
					{isNetwork && <p className='text-center text-13 text-white/50'>{t('connection-lost-description')}</p>}
				</div>
				<div className='flex w-full flex-col gap-2.5 md:flex-row md:justify-center'>
					{/* Uses variant='default' (not 'primary') because the brand color CSS variable
					    is set by the wallpaper provider, which isn't available at this level. */}
					<Button size='dialog' variant='default' onClick={() => window.location.reload()}>
						{isNetwork ? t('reconnect') : t('reload')}
					</Button>
					{!isNetwork && (
						<Button size='dialog' variant='default' onClick={() => downloadLogs()}>
							{t('download-logs')}
						</Button>
					)}
				</div>
				{error != null && (
					<div className='-mb-4 flex flex-col items-center'>
						<button
							type='button'
							onClick={() => setShowDetails((prev) => !prev)}
							className='flex items-center gap-0.5 text-11 text-white/30 transition-opacity duration-300 hover:text-white/50'
						>
							{showDetails ? t('hide-details') : t('show-details')}
							{showDetails ? <ChevronUp className='size-3' /> : <ChevronDown className='size-3' />}
						</button>
						{showDetails && (
							<p className='mt-1 max-h-40 w-full overflow-y-auto text-11 break-all text-white/30'>
								{getErrorMessage(error)}
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
