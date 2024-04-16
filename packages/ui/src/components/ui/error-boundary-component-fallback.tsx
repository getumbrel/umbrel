import {GenericErrorText} from '@/components/ui/generic-error-text'
import {Badge} from '@/shadcn-components/ui/badge'

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
