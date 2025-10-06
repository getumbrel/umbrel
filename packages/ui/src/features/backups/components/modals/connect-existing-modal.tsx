// Modal shown when a backup repository is detected at the selected location but
// is not yet connected to this Umbrel. Prompts for the encryption password and
// provides Connect/Cancel actions.
import backupsIcon from '@/features/backups/assets/backups-icon.png'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {FormLabel} from '@/shadcn-components/ui/form'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {t} from '@/utils/i18n'

export function ConnectExistingModal({
	open,
	password,
	onPasswordChange,
	onClose,
	onConnect,
	isConnecting,
}: {
	open: boolean
	folderPath: string | undefined
	password: string
	onPasswordChange: (v: string) => void
	onClose: () => void
	onConnect: () => void
	isConnecting?: boolean
}) {
	return (
		<Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
			<DialogContent className='flex flex-col items-center text-center'>
				<DialogHeader className='items-center text-center'>
					<img
						src={backupsIcon}
						alt={t('files-type.umbrel-backup')}
						className='mb-2 size-10 opacity-80'
						draggable={false}
					/>
					<DialogTitle>{t('backups.modals.connect-existing.title')}</DialogTitle>
					<DialogDescription>{t('backups.modals.connect-existing.description')}</DialogDescription>
				</DialogHeader>
				<div className='w-full space-y-2 text-left'>
					<FormLabel className='text-13 opacity-60'>{t('backups-restore.encryption-password')}</FormLabel>
					<PasswordInput value={password} onValueChange={onPasswordChange} />
				</div>
				<DialogFooter className='justify-center gap-2 pt-2'>
					<Button variant='primary' size='dialog' disabled={!password || isConnecting} onClick={onConnect}>
						{t('connect')}
					</Button>
					<Button variant='default' size='dialog' onClick={onClose} disabled={isConnecting}>
						{t('cancel')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
