import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useTimeoutFn} from 'react-use'

import {GenericErrorText} from '@/components/ui/generic-error-text'
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

// Ensures we don't show multiple error dialogs if we put error boundaries around each item in a list and multiple of them throw
let GLOBAL_SHOWING_ERROR_DIALOG = false

/**
 * Used for when we can replace the error with text. EX: buttons, page content
 */
export function ErrorBoundaryComponentFallback() {
	const navigate = useNavigate()
	const [open, setOpen] = useState(false)

	// When showing dialog in another dialog, auto-opening causes the error dialog to open behind the throwing dialog
	useTimeoutFn(() => {
		if (GLOBAL_SHOWING_ERROR_DIALOG) return
		setOpen(true)
		GLOBAL_SHOWING_ERROR_DIALOG = true
	}, 200)

	useEffect(() => {
		if (GLOBAL_SHOWING_ERROR_DIALOG && !open) {
			GLOBAL_SHOWING_ERROR_DIALOG = false
		}
	}, [open])

	return (
		<>
			<div>
				<Button size={'dialog'} className='inline-block' onClick={() => setOpen(true)}>
					<GenericErrorText />
				</Button>
			</div>
			<AlertDialog open={open} onOpenChange={setOpen}>
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
