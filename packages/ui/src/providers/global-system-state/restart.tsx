import {useTranslation} from 'react-i18next'

import {Cover} from '@/components/ui/cover'
import {isFailsafeRestart} from '@/features/storage/restart-reason'
import {trpcReact, type RouterError} from '@/trpc/trpc'

export function useRestart({
	onMutate,
	onSuccess,
	onError,
}: {
	onMutate?: () => void
	onSuccess?: (didWork: boolean) => void
	onError?: (error: RouterError) => void
}) {
	const restartMut = trpcReact.system.restart.useMutation({
		// A restart must fail now rather than queue and run when connectivity returns.
		networkMode: 'always',
		retry: false,
		onMutate,
		onSuccess,
		onError,
	})
	const restart = restartMut.mutate

	return restart
}

export function RestartingCover() {
	const {t} = useTranslation()
	return (
		<Cover
			title={t('restart.restarting')}
			// A switch to FailSafe restarts umbrelOS by itself: say so, or it looks like a crash
			description={isFailsafeRestart() ? t('storage-mgr.restart.reason') : undefined}
			progress='spinner'
		/>
	)
}
