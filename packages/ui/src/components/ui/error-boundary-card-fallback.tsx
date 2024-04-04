import {Card} from '@/components/ui/card'
import {GenericErrorText} from '@/components/ui/generic-error-text'

/**
 * Used for larger areas like the settings page, dialog content, etc.
 */
export function ErrorBoundaryCardFallback() {
	return (
		// Wrap div to prevent flex parent from sizing this element inappropriately
		<Card className='grid w-full place-items-center animate-in fade-in zoom-in-150 md:h-60'>
			<GenericErrorText />
		</Card>
	)
}
