import {useTranslation} from 'react-i18next'

import {BareCoverMessage} from '@/components/ui/cover-message'
import {trpcReact} from '@/trpc/trpc'

export function EnsureBackendAvailable({children}: {children: React.ReactNode}) {
	const {t} = useTranslation()
	// TODO: probably want a straightforward `fetch` call here instead of using trpc. This will allow us to check if the backend is available before we even load the trpc provider.
	const getQuery = trpcReact.system.online.useQuery(undefined, {
		retry: false,
	})

	if (getQuery.isLoading) {
		return <BareCoverMessage delayed>{t('trpc.checking-backend')}</BareCoverMessage>
	}

	if (getQuery.error) {
		return <BareCoverMessage>{t('trpc.backend-unavailable')}</BareCoverMessage>
	}

	return children
}
