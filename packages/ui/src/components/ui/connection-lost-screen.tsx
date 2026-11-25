import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {Cover} from '@/components/ui/cover'

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	return String(error)
}

// Drawn in place rather than in the cover target: the root error fallback shows this above every
// provider, after the tree that held the target has gone.
export function ConnectionLostScreen({error, onReconnect}: {error?: unknown; onReconnect: () => void}) {
	const {t} = useTranslation()

	return (
		<Cover
			standalone
			surface='black'
			mark='logo-dimmed'
			title={t('connection-lost')}
			description={t('connection-lost-description')}
			actions={
				// Not the brand colour: the wallpaper provider sets it, and this screen may render outside it
				<Button size='dialog' variant='secondary' onClick={onReconnect}>
					{t('reconnect')}
				</Button>
			}
			details={error != null ? getErrorMessage(error) : undefined}
		/>
	)
}
