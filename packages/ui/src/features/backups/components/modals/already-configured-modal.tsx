// Modal presented when the chosen backup folder already contains an Umbrel backup
// that is currently in use on this Umbrel. Provides a quick action to manage it.
import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {t} from '@/utils/i18n'

export function AlreadyConfiguredModal({
	open,
	folderPath,
	onClose,
	onManage,
}: {
	open: boolean
	folderPath: string | undefined
	onClose: () => void
	onManage: () => void
}) {
	return (
		<Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
			<DialogContent className='flex flex-col items-center text-center'>
				<DialogHeader className='items-center text-center'>
					<BackupDeviceIcon path={folderPath || ''} className='mb-2 size-10 opacity-80' />
					<DialogTitle>{t('backups.modals.already-in-use.title')}</DialogTitle>
					<DialogDescription>{t('backups.modals.already-in-use.description')}</DialogDescription>
				</DialogHeader>
				<DialogFooter className='justify-center gap-2 pt-2'>
					<Button variant='primary' size='dialog' onClick={onManage}>
						{t('backups.modals.already-in-use.manage')}
					</Button>
					<Button variant='default' size='dialog' onClick={onClose}>
						{t('close')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
