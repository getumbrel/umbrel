import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useShutdown({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const shutdownMut = trpcReact.system.shutdown.useMutation({
		onMutate,
		onSuccess,
	})
	const shutdown = shutdownMut.mutate

	return shutdown
}

export function ShuttingDownCover() {
	return (
		<CoverMessage>
			<Loading>{t('shut-down.shutting-down')}</Loading>
			<CoverMessageParagraph>{t('shut-down.shutting-down-message')}</CoverMessageParagraph>
		</CoverMessage>
	)
}
