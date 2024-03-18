import {useNavigate} from 'react-router-dom'

import {Wallpaper} from '@/providers/wallpaper'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {Button} from '@/shadcn-components/ui/button'
import {downloadLogs} from '@/utils/logs'
import {t} from '@/utils/i18n'

export function ErrorBoundary() {
	const navigate = useNavigate()

	return (
		<>
			<Wallpaper />
			<AlertDialog open={true}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('something-went-wrong')}</AlertDialogTitle>
						<AlertDialogDescription></AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => navigate('/')}>{t('not-found-404.home')}</AlertDialogAction>
						<Button size="dialog" variant="default" onClick={() => downloadLogs()}>{t('download-logs')}</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}