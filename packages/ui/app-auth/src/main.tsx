import 'inter-ui/inter.css'

import React from 'react'
import ReactDOM from 'react-dom/client'

import '../../src/index.css'

import i18next from 'i18next'
import {ErrorBoundary} from 'react-error-boundary'
import {BrowserRouter} from 'react-router-dom'

import {IframeChecker} from '../../src/components/iframe-checker'
import {BareCoverMessage} from '../../src/components/ui/cover-message'
import {Toaster} from '../../src/components/ui/toast'
import LoginWithUmbrel from '../../src/routes/login-with-umbrel'
import {TooltipProvider} from '../../src/shadcn-components/ui/tooltip'
import {t} from '../../src/utils/i18n'

i18next.on('initialized', () => {
	ReactDOM.createRoot(document.getElementById('root')!).render(
		<React.StrictMode>
			<IframeChecker>
				<ErrorBoundary fallback={<BareCoverMessage>{t('something-went-wrong')}</BareCoverMessage>}>
					<TooltipProvider>
						<BrowserRouter>
							<LoginWithUmbrel />
						</BrowserRouter>
					</TooltipProvider>
					<Toaster />
				</ErrorBoundary>
			</IframeChecker>
		</React.StrictMode>,
	)
})
