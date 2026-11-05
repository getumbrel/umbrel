import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Dock, DockBottomPositioner} from '@/modules/desktop/dock'
import {AppsProvider} from '@/providers/apps'
import {AvailableAppsProvider} from '@/providers/available-apps'
import {Wallpaper} from '@/providers/wallpaper'

export function NotFound() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	// Back only leads somewhere when this tab came here from another page of umbrelOS
	const canGoBack = (window.history.state?.idx ?? 0) > 0

	return (
		<>
			<Wallpaper />
			<AvailableAppsProvider>
				<AppsProvider>
					<DockBottomPositioner>
						<Dock />
					</DockBottomPositioner>
				</AppsProvider>
			</AvailableAppsProvider>
			{/* Always open: closing it would leave an empty screen with nowhere to go */}
			<AlertDialog open>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('not-found-404')}</AlertDialogTitle>
						<AlertDialogDescription>{t('not-found-404.description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => navigate('/')}>{t('not-found-404.home')}</AlertDialogAction>
						{canGoBack && <AlertDialogCancel onClick={() => navigate(-1)}>{t('not-found-404.back')}</AlertDialogCancel>}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
