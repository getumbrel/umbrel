import {useTranslation} from 'react-i18next'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {type RouterError, trpcReact} from '@/trpc/trpc'

export function useRestart({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const restartMut = trpcReact.system.restart.useMutation({
		onMutate,
		onSuccess,
	})
	const restart = restartMut.mutate

	return restart
}

export function useRestartWithPassword({
	onMutate,
	onSuccess,
	onError,
}: {
	onMutate?: () => void
	onSuccess?: (didWork: boolean) => void
	onError?: (error: RouterError) => void
}) {
	const restartMut = trpcReact.system.restartWithPassword.useMutation({
		onMutate,
		onSuccess,
		onError,
	})
	return restartMut.mutateAsync
}

export function RestartingCover() {
	const {t} = useTranslation()
	return (
		<CoverMessage>
			<Loading>{t('restart.restarting')}</Loading>
			<CoverMessageParagraph>{t('restart.restarting-message')}</CoverMessageParagraph>
		</CoverMessage>
	)
}
