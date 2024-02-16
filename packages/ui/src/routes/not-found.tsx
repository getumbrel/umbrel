import {useNavigate} from 'react-router-dom'

import {Wallpaper} from '@/providers/wallpaper'
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

export function NotFound() {
	const navigate = useNavigate()

	return (
		<>
			<Wallpaper />
			<AlertDialog open={true}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('not-found-404')}</AlertDialogTitle>
						<AlertDialogDescription></AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => navigate(-1)}>{t('not-found-404.back')}</AlertDialogCancel>
						<AlertDialogAction onClick={() => navigate('/')}>{t('not-found-404.home')}</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
