import {useTranslation} from 'react-i18next'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {trpcReact} from '@/trpc/trpc'

export function useRestart({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const restartMut = trpcReact.system.restart.useMutation({
		onMutate,
		onSuccess,
	})
	const restart = restartMut.mutate

	return restart
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
