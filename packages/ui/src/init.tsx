import 'inter-ui/inter.css'
import './index.css'
import './utils/i18n'

import i18next from 'i18next'
import React, {Suspense} from 'react'
import ReactDOM from 'react-dom/client'
import {ErrorBoundary} from 'react-error-boundary'

import {IframeChecker} from '@/components/iframe-checker'
import {CoverMessageTarget} from '@/components/ui/cover-message'
import {RootErrorFallback} from '@/components/ui/root-error-fallback'
import {Toaster} from '@/components/ui/toast'
import {TooltipProvider} from '@/components/ui/tooltip'
import {monkeyPatchConsoleLog} from '@/utils/logs'
import {allowsNativeContextMenu} from '@/utils/native-context-menu'

monkeyPatchConsoleLog()

// Disable the browser context menu for a native OS feel, except on text fields and opted-in surfaces
document.addEventListener(
	'contextmenu',
	(event) => {
		if (allowsNativeContextMenu(event.target)) return
		event.preventDefault()
		return false
	},
	{passive: false},
)

// Refuse a file dragged in from the desktop wherever nothing takes it, or the browser opens the
// file in place of umbrelOS. Upload areas handle their drag and drop before it gets here.
window.addEventListener('dragover', (event) => {
	if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files')) return
	event.preventDefault()
	event.dataTransfer.dropEffect = 'none'
})
window.addEventListener('drop', (event) => {
	if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
})

export function init(element: React.ReactNode) {
	i18next.on('initialized', () => {
		// React 19 error callbacks — centralized logging for all React errors.
		// These feed into the monkey-patched console.error, so errors are captured
		// in the downloadable log buffer even when error boundaries silently swallow them.
		// onUncaughtError and onRecoverableError have no react-error-boundary equivalent.
		ReactDOM.createRoot(document.getElementById('root')!, {
			onCaughtError(error, errorInfo) {
				console.error('Caught by error boundary:', error)
				console.error('Component stack:', errorInfo.componentStack)
			},
			onUncaughtError(error, errorInfo) {
				console.error('Uncaught React error:', error)
				console.error('Component stack:', errorInfo.componentStack)
			},
			onRecoverableError(error, errorInfo) {
				console.error('Recoverable React error:', error)
				console.error('Component stack:', errorInfo.componentStack)
			},
		}).render(
			<React.StrictMode>
				<IframeChecker>
					<Suspense>
						<ErrorBoundary fallbackRender={({error}) => <RootErrorFallback error={error} />}>
							<TooltipProvider>
								{element}
								<Toaster />
								{/* Put `CoverMessageTarget` after `Toaster` because we don't want toasts to show up on these pages */}
								<CoverMessageTarget />
							</TooltipProvider>
						</ErrorBoundary>
					</Suspense>
				</IframeChecker>
			</React.StrictMode>,
		)
	})
}
