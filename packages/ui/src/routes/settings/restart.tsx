import { RiRestartLine } from 'react-icons/ri'
import { useNavigate } from 'react-router-dom'

import { CoverMessage, CoverMessageParagraph } from '@/components/ui/cover-message'
import { Loading } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { UmbrelHeadTitle } from '@/components/umbrel-head-title'
import { useShutdownRestartPolling } from '@/hooks/use-shutdown-restart-polling'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import { trpcReact } from '@/trpc/trpc'
import { useDialogOpenProps } from '@/utils/dialog'
import { t } from '@/utils/i18n'

export default function RestartDialog() {
	const dialogProps = useDialogOpenProps('restart')
	const navigate = useNavigate()

	const {startExpectingFailure, canManualPing, manualPing} = useShutdownRestartPolling({
		onSucceedingAgain: () => {
			toast.success('Restart successful')
			navigate('/')
		},
	})

	const restartMut = trpcReact.system.reboot.useMutation({
		onSuccess: () => startExpectingFailure(),
	})

	if (restartMut.isError) {
		const title = t('restart.failed')
		return (
			<>
				<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
				<CoverMessage>{title}</CoverMessage>
			</>
		)
	}

	if (canManualPing) {
		const title = t('restart.restarting')
		return (
			// Clicking anywhere will trigger a ping
			<CoverMessage
				onClick={() => {
					manualPing()
					toast('Checking manually...')
				}}
			>
				<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
				<Loading>{title}</Loading>
				<CoverMessageParagraph>{t('restart.restarting-message')}</CoverMessageParagraph>
			</CoverMessage>
		)
	}

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiRestartLine}>
					<UmbrelHeadTitle>{t('restart')}</UmbrelHeadTitle>
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
