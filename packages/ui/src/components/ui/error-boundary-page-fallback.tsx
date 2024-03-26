import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {Dock, DockBottomPositioner} from '@/modules/desktop/dock'
import {AppsProvider} from '@/providers/apps'
import {AvailableAppsProvider} from '@/providers/available-apps'
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
import {t} from '@/utils/i18n'
import {downloadLogs} from '@/utils/logs'

/**
 * Used for when we can't reasonably replace the component with error text. EX: wallpaper or cmdk
 */
export function ErrorBoundaryPageFallback() {
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	return (
		<>
			<Wallpaper />
			<AppsProvider>
				<AvailableAppsProvider>
					<DockBottomPositioner>
						<Dock />
					</DockBottomPositioner>
				</AvailableAppsProvider>
			</AppsProvider>
			<AlertDialog open={open} onOpenChange={(o) => setOpen(o)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('something-went-wrong')}</AlertDialogTitle>
						<AlertDialogDescription></AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => navigate('/')}>{t('not-found-404.home')}</AlertDialogAction>
						<Button size='dialog' variant='default' onClick={() => downloadLogs()}>
							{t('download-logs')}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
