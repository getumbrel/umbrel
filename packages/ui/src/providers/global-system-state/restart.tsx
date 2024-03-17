import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useRestart({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const restartMut = trpcReact.system.restart.useMutation({
		onMutate,
		onSuccess,
	})
	const restart = restartMut.mutate

	return restart
}

export function RestartingCover() {
	return (
		<CoverMessage>
			<Loading>{t('restart.restarting')}</Loading>
			<CoverMessageParagraph>{t('restart.restarting-message')}</CoverMessageParagraph>
		</CoverMessage>
	)
}
