import {useTranslation} from 'react-i18next'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
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
		<CoverMessage>
			<Loading>{t('restart.restarting')}</Loading>
			{/* A switch to FailSafe restarts umbrelOS by itself: say so, or it looks like a crash */}
			{isFailsafeRestart() && <CoverMessageParagraph>{t('storage-mgr.restart.reason')}</CoverMessageParagraph>}
			<CoverMessageParagraph>{t('restart.restarting-message')}</CoverMessageParagraph>
		</CoverMessage>
	)
}
