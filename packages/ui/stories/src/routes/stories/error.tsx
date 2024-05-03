import {useErrorBoundary} from 'react-error-boundary'

import {Button} from '@/shadcn-components/ui/button'

export default function ErrorStory() {
	const {showBoundary} = useErrorBoundary()

	return (
		<div>
			<Button
				variant='primary'
				onClick={() => {
					showBoundary(new Error('Error thrown from button'))
				}}
			>
				Throw error
			</Button>
			<Button
				variant='primary'
				onClick={() => {
					showBoundary(
						new Error(
							'Sit Lorem occaecat dolore ad reprehenderit sit reprehenderit. Quis aliquip irure tempor esse laborum aute quis incididunt consectetur sunt commodo enim pariatur.',
						),
					)
				}}
			>
				Throw long error
			</Button>
		</div>
	)
}
