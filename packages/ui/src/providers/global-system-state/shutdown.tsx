import {useTranslation} from 'react-i18next'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {type RouterError, trpcReact} from '@/trpc/trpc'

export function useShutdown({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const shutdownMut = trpcReact.system.shutdown.useMutation({
		onMutate,
		onSuccess,
	})
	const shutdown = shutdownMut.mutate

	return shutdown
}

export function useShutdownWithPassword({
	onMutate,
	onSuccess,
	onError,
}: {
	onMutate?: () => void
	onSuccess?: (didWork: boolean) => void
	onError?: (error: RouterError) => void
}) {
	const shutdownMut = trpcReact.system.shutdownWithPassword.useMutation({
		onMutate,
		onSuccess,
		onError,
	})
	return shutdownMut.mutateAsync
}

export function ShuttingDownCover() {
	const {t} = useTranslation()
	return (
		<CoverMessage>
			<Loading>{t('shut-down.shutting-down')}</Loading>
			<CoverMessageParagraph>{t('shut-down.shutting-down-message')}</CoverMessageParagraph>
		</CoverMessage>
	)
}
