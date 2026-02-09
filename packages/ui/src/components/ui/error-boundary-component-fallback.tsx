import {Badge} from '@/components/ui/badge'
import {GenericErrorText} from '@/components/ui/generic-error-text'

/**
 * Used for when we can replace the error with text. EX: buttons, page content
 */
export function ErrorBoundaryComponentFallback() {
	return (
		// Wrap div to prevent flex parent from sizing this element inappropriately
		<div>
			<Badge variant={'default'}>
				<GenericErrorText />
			</Badge>
		</div>
	)
}
