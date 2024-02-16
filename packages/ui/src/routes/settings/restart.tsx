import {RiRestartLine} from 'react-icons/ri'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
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

export default function RestartDialog() {
	useUmbrelTitle(t('restart'))
	const dialogProps = useDialogOpenProps('restart')

	const restartMut = trpcReact.system.reboot.useMutation()

	// TODO: redirect to `/restart` route instead of showing this cover message
	if (restartMut.isLoading) {
		return (
			<CoverMessage>
				<Loading>{t('restart.restarting')}</Loading>
				<CoverMessageParagraph>{t('restart.restarting-message')}</CoverMessageParagraph>
			</CoverMessage>
		)
	}

	if (restartMut.isError) {
		return <CoverMessage>{t('restart.failed')}</CoverMessage>
	}

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiRestartLine}>
					<AlertDialogTitle>{t('restart.confirm.title')}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						className='px-6'
						onClick={(e) => {
							// Prevent closing by default
							e.preventDefault()
							restartMut.mutate()
						}}
					>
						{t('restart.confirm.submit')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
