import {ChevronDown, ChevronUp} from 'lucide-react'
import {useState} from 'react'
import type {FallbackProps} from 'react-error-boundary'
import {useNavigate, useRouteError} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {Dock, DockBottomPositioner} from '@/modules/desktop/dock'
import {AppsProvider} from '@/providers/apps'
import {AvailableAppsProvider} from '@/providers/available-apps'
import {Wallpaper} from '@/providers/wallpaper'
import {t} from '@/utils/i18n'
import {downloadLogs} from '@/utils/logs'

function useRouteErrorSafe() {
	try {
		return useRouteError()
	} catch {
		return null
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	return String(error)
}

/**
 * Used for when we can't reasonably replace the component with error text. EX: wallpaper or cmdk
 */
export function ErrorBoundaryPageFallback({error}: Partial<FallbackProps> = {}) {
	const navigate = useNavigate()
	const [showDetails, setShowDetails] = useState(false)

	const routeError = useRouteErrorSafe()
	const resolvedError = error ?? routeError

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
			<AlertDialog open>
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
					{resolvedError != null && (
						<div className='-mb-4 flex flex-col items-center'>
							<button
								type='button'
								onClick={() => setShowDetails((prev) => !prev)}
								className='flex items-center gap-0.5 text-11 text-white/30 transition-opacity duration-300 hover:text-white/50'
							>
								{showDetails ? t('hide-details') : t('show-details')}
								{showDetails ? <ChevronUp className='size-3' /> : <ChevronDown className='size-3' />}
							</button>
							{showDetails && (
								<p className='mt-1 max-h-40 w-full overflow-y-auto text-11 break-all text-white/30'>
									{getErrorMessage(resolvedError)}
								</p>
							)}
						</div>
					)}
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
