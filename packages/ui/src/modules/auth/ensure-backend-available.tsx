import {BareCoverMessage} from '@/components/ui/cover-message'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function EnsureBackendAvailable({children}: {children: React.ReactNode}) {
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
