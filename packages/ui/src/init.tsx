import 'inter-ui/inter.css'
import './index.css'
import './utils/i18n'

import i18next from 'i18next'
import React, {Suspense} from 'react'
import ReactDOM from 'react-dom/client'
import {ErrorBoundary} from 'react-error-boundary'
import {HelmetProvider} from 'react-helmet-async'

import {IframeChecker} from '@/components/iframe-checker'
import {BareCoverMessage, CoverMessageTarget} from '@/components/ui/cover-message'
import {Toaster} from '@/components/ui/toast'
import {TooltipProvider} from '@/shadcn-components/ui/tooltip'
import {t} from '@/utils/i18n'

export function init(element: React.ReactNode) {
	i18next.on('initialized', () => {
		ReactDOM.createRoot(document.getElementById('root')!).render(
			<React.StrictMode>
				<HelmetProvider>
					<IframeChecker>
						<Suspense>
							<ErrorBoundary fallback={<BareCoverMessage>{t('something-went-wrong')}</BareCoverMessage>}>
								<TooltipProvider>
									{element}
									<Toaster />
									{/* Want to show cover message over Toast elements */}
									<CoverMessageTarget />
								</TooltipProvider>
							</ErrorBoundary>
						</Suspense>
					</IframeChecker>
				</HelmetProvider>
			</React.StrictMode>,
		)
	})
}
