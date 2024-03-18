import {Markdown} from '@/components/markdown'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/shadcn-components/ui/dialog'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function SoftwareUpdateConfirmDialog() {
	const {update} = useGlobalSystemState()
	const latestVersionQ = trpcReact.system.checkUpdate.useQuery()
	const dialogProps = useSettingsDialogProps()

	if (latestVersionQ.isLoading) {
		return null
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent className='px-0'>
				<DialogHeader className='px-4 sm:px-8'>
					<DialogTitle>{latestVersionQ.data?.name}</DialogTitle>
				</DialogHeader>
				<ScrollArea className='flex max-h-[500px] flex-col gap-5 px-4 sm:px-8'>
					<Markdown>{latestVersionQ.data?.releaseNotes}</Markdown>
				</ScrollArea>
				<DialogFooter className='px-4 sm:px-8'>
					<Button
						variant='primary'
						size='dialog'
						onClick={() => {
							dialogProps.onOpenChange(false)
							update()
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
