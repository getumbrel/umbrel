import {TorIcon2} from '@/assets/tor-icon2'
import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
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
import {t} from '@/utils/i18n'

export default function ConfirmEnableTorDialog() {
	const title = t('tor.enable.title')
	const dialogProps = useSettingsDialogProps()

	const {setEnabled, isError, isMutLoading} = useTorEnabled({
		onSuccess: () => {
			dialogProps.onOpenChange(false)
			toast.success(t('tor.enable.success'))
		},
	})

	if (isError) {
		dialogProps.onOpenChange(false)
	}

	if (isMutLoading) {
		return (
			<CoverMessage>
				<Loading>Enabling Tor</Loading>
				<CoverMessageParagraph>{t('tor.enable.description')}</CoverMessageParagraph>
			</CoverMessage>
		)
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
