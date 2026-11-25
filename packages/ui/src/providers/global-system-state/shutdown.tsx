import {useTranslation} from 'react-i18next'

import {Cover} from '@/components/ui/cover'
import {trpcReact, type RouterError} from '@/trpc/trpc'

export function useShutdown({
	onMutate,
	onSuccess,
	onError,
}: {
	onMutate?: () => void
	onSuccess?: (didWork: boolean) => void
	onError?: (error: RouterError) => void
}) {
	const shutdownMut = trpcReact.system.shutdown.useMutation({
		// A shutdown must fail now rather than queue and run when connectivity returns.
		networkMode: 'always',
		retry: false,
		onMutate,
		onSuccess,
		onError,
	})
	const shutdown = shutdownMut.mutate

	return shutdown
}

export function ShuttingDownCover() {
	const {t} = useTranslation()
	return <Cover title={t('shut-down.shutting-down')} progress='spinner' />
}
