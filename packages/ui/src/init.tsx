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

monkeyPatchConsoleLog()

// Disable default browser context menu
document.addEventListener(
	'contextmenu',
	(event) => {
		event.preventDefault()
		return false
	},
	{passive: false},
)

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
