import {TorIcon2} from '@/assets/tor-icon2'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function ConfirmEnableTorDialog() {
	const title = t('tor.enable.title')
	const dialogProps = useDialogOpenProps('tor')

	const {setEnabled, isError} = useTorEnabled()

	if (isError) {
		throw new Error(t('tor.enable.failed'))
	}

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={TorIcon2}>
					<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{t('tor.enable.description')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						className='px-6'
						onClick={() => {
							setEnabled(true)
							dialogProps.onOpenChange(false)
						}}
					>
						{t('tor.enable.submit')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
