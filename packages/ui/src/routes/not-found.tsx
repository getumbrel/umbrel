import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {Dock, DockBottomPositioner} from '@/modules/desktop/dock'
import {AppsProvider} from '@/providers/apps'
import {AvailableAppsProvider} from '@/providers/available-apps'
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
	const [open, setOpen] = useState(true)

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
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('not-found-404')}</AlertDialogTitle>
						<AlertDialogDescription></AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => navigate(-1)}>{t('not-found-404.back')}</AlertDialogAction>
						<AlertDialogCancel onClick={() => navigate('/')}>{t('not-found-404.home')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
