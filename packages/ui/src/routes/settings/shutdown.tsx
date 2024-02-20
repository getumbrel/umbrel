import {RiShutDownLine} from 'react-icons/ri'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function ShutdownDialog() {
	const dialogProps = useDialogOpenProps('shutdown')

	const shutdownMut = trpcReact.system.shutdown.useMutation()

	if (shutdownMut.isLoading || shutdownMut.isError) {
		return (
			<CoverMessage>
				<Loading>{t('shut-down.shutting-down')}</Loading>
				<CoverMessageParagraph>{t('shut-down.shutting-down-message')}</CoverMessageParagraph>
			</CoverMessage>
		)
	}

	// TODO: consider just doing throw here
	if (shutdownMut.isError) {
		const title = t('shut-down.failed')
		return (
			<>
				<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
				<CoverMessage>{title}</CoverMessage>
			</>
		)
	}

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiShutDownLine}>
					<UmbrelHeadTitle>{t('shut-down')}</UmbrelHeadTitle>
					<AlertDialogTitle>{t('shut-down.confirm.title')}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						onClick={(e) => {
							// Prevent closing by default
							e.preventDefault()
							shutdownMut.mutate()
						}}
					>
						{t('shut-down.confirm.submit')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
