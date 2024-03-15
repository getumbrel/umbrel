// import {useErrorBoundary} from 'react-error-boundary'
import {useState} from 'react'

import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/shadcn-components/ui/dialog'
import {t} from '@/utils/i18n'
import {downloadLogs} from '@/utils/logs'

import {CoverMessage} from './cover-message'

export function ErrorBoundary() {
	// const error = useRouteError()
	const [open, setOpen] = useState(true)

	// TODO: reset doesn't work
	// const {resetBoundary} = useErrorBoundary()
	// console.error(error)

	return (
		<CoverMessage>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('something-went-wrong')}</DialogTitle>
						{/* <DialogDescription>
							Lorem ipsum dolor sit amet consectetur adipisicing elit. Illo aspernatur in consequatur illum quos non
							voluptatum quidem, laboriosam natus praesentium soluta, aliquam fugit harum dolore exercitationem saepe
							nihil ad quia.
						</DialogDescription> */}
					</DialogHeader>
					<DialogFooter>
						<Button
							size='dialog'
							variant='primary'
							onClick={() => {
								downloadLogs()
							}}
						>
							{t('download-logs')}
						</Button>
						<Button
							size='dialog'
							onClick={() => {
								window.location.reload()
							}}
						>
							{t('retry')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</CoverMessage>
	)
}
