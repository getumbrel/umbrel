// import {useErrorBoundary} from 'react-error-boundary'
import {useRouteError} from 'react-router-dom'

import {Button} from '../../shadcn-components/ui/button'
import {CoverMessage} from './cover-message'

export function ErrorBoundary() {
	const error = useRouteError()
	// TODO: reset doesn't work
	// const {resetBoundary} = useErrorBoundary()
	// console.error(error)
	return (
		<CoverMessage>
			<div className=''>
				<h1 className='font-semibold text-destructive2-lightest'>⚠ Dang!</h1>
				<p className='max-w-sm text-13'>{error instanceof Error ? error.message : 'Unexpected error'}</p>
				<div className='mt-2 flex items-center gap-2'>
					{/* <Button variant='secondary' size='sm' onClick={resetBoundary}>
						Try Again
					</Button> */}
					<Button variant='secondary' size='sm' onClick={() => window.location.reload()}>
						Reload Page
					</Button>
				</div>
			</div>
		</CoverMessage>
	)
}
