import {TorIcon2} from '@/assets/tor-icon2'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
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
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('tor')

	const {setEnabled, isError} = useTorEnabled()

	if (isError) {
		throw new Error(t('tor.enable.failed'))
	}

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={TorIcon2}>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{t('tor.enable.description')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						className='px-6'
						onClick={() => {
							// Prevent closing by default
							setEnabled(true)
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
