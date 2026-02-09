import type {FallbackProps} from 'react-error-boundary'
import {useRouteError} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Card} from '@/components/ui/card'
import {GenericErrorDetails, GenericErrorText} from '@/components/ui/generic-error-text'
import {t} from '@/utils/i18n'

function useRouteErrorSafe() {
	try {
		return useRouteError()
	} catch {
		return null
	}
}

/**
 * Used for larger areas like the settings page, dialog content, etc.
 */
export function ErrorBoundaryCardFallback({error, resetErrorBoundary}: Partial<FallbackProps>) {
	const routeError = useRouteErrorSafe()
	const resolvedError = error ?? routeError

	return (
		// Wrap div to prevent flex parent from sizing this element inappropriately
		<div className='relative w-full'>
			<Card className='grid w-full animate-in place-items-center fade-in zoom-in-150 md:h-60'>
				<div className='flex flex-col items-center gap-2'>
					<GenericErrorText />
					{resetErrorBoundary && (
						<Button size='sm' variant='default' onClick={resetErrorBoundary}>
							{t('try-again')}
						</Button>
					)}
				</div>
			</Card>
			{resolvedError != null && <GenericErrorDetails error={resolvedError} />}
		</div>
	)
}
