import {useTranslation} from 'react-i18next'
import {Navigate} from 'react-router-dom'

import {Markdown} from '@/components/markdown'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {ScrollArea} from '@/components/ui/scroll-area'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {trpcReact} from '@/trpc/trpc'

export function SoftwareUpdateConfirmDialog() {
	const {t} = useTranslation()
	const {update} = useGlobalSystemState()
	const latestVersionQ = trpcReact.update.check.useQuery()
	const dialogProps = useSettingsDialogProps()

	if (latestVersionQ.isLoading) {
		return null
	}

	// Reachable by a stale link or back/forward after the update was installed or
	// the check failed. With no newer version there's nothing to install, so
	// return to Settings, which shows the update status
	if (!latestVersionQ.data?.available) {
		return <Navigate to='/settings' replace />
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent className='px-0'>
				<DialogHeader className='px-4 sm:px-8'>
					<DialogTitle>{latestVersionQ.data.name}</DialogTitle>
				</DialogHeader>
				<ScrollArea className='flex max-h-[500px] flex-col gap-5 px-4 sm:px-8'>
					<Markdown>{latestVersionQ.data.releaseNotes}</Markdown>
				</ScrollArea>
				<DialogFooter className='px-4 sm:px-8'>
					<Button
						variant='primary'
						size='dialog'
						onClick={() => {
							dialogProps.onOpenChange(false)
							update(latestVersionQ.data?.manifestHash)
						}}
					>
						{t('software-update.install-now')}
					</Button>
					<Button size='dialog' onClick={() => dialogProps.onOpenChange(false)}>
						{t('cancel')}
					</Button>
					{/* <DialogAction variant='destructive' className='px-6' onClick={logout}>
						{t('logout.confirm.submit')}
					</DialogAction>
					<DialogCancel>{t('cancel')}</DialogCancel> */}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// const sampleMarkdownReleaseNotes = `
// # What's new

// Lorem ipsum dolor sit amet consectetur adipisicing elit. Quisquam, quam. Quam, quisquam. Quisquam, quam. Quam,
// quisquam. Quisquam, quam. Quam, quisquam. Quisquam, quam. Quam, quisquam. Quisquam, quam. Quam, quisquam. Quisquam,

// ## New features

// ### More support:

// - Added support for the Raspberry Pi 4 and 400
// - Added support for the Raspberry Pi 5 and 500
// - Added support for the Raspberry Pi 6 and 600
// - Added support for the Raspberry Pi 7 and 700
// - Added support for the Raspberry Pi 8 and 800

// ### Improvements

// [Lorem ipsum dolor](https://umbrel.com) sit amet consectetur adipisicing elit. Quisquam, quam. Quam, quisquam. Quisquam, quam. Quam,
// quisquam. Quisquam, quam. Quam, quisquam. Quisquam, quam. Quam, quisquam. Quisquam, quam. Quam, quisquam. Quisquam,

// ### Fixes

// Lorem ipsum dolor sit amet consectetur adipisicing elit. Quisquam, quam. Quam, quisquam. Quisquam, quam. Quam,
// `
