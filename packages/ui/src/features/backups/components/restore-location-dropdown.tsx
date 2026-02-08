// We reuse this dropdown for both the:
// - Restore wizard accessed via settings
// - Restore flow during onboarding

import {ChevronDown} from 'lucide-react'
import {useState} from 'react'
import {TbAlertTriangleFilled} from 'react-icons/tb'

import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {t} from '@/utils/i18n'

type RestoreLocationDropdownProps = {
	onSelect: (root: string) => void
	isExternalStorageSupported?: boolean
}

export function RestoreLocationDropdown({onSelect, isExternalStorageSupported = true}: RestoreLocationDropdownProps) {
	const [showUnsupportedDialog, setShowUnsupportedDialog] = useState(false)

	const handleExternalClick = () => {
		if (isExternalStorageSupported) {
			onSelect('/External')
		} else {
			setShowUnsupportedDialog(true)
		}
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type='button'
						size='sm'
						className='absolute top-1/2 right-5 inline-flex -translate-y-1/2 items-center gap-1'
					>
						{t('backups-restore.choose')}
						<ChevronDown className='size-3' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='min-w-[320px]'>
					<DropdownMenuItem className='block cursor-pointer' onSelect={() => onSelect('/Network')}>
						<div className='flex w-full flex-col items-start'>
							<div className='text-sm font-medium'>{t('backups-restore.browse-nas-title')}</div>
							<div className='text-xs opacity-60'>{t('backups-restore.browse-nas-subtitle')}</div>
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem className='block cursor-pointer' onSelect={handleExternalClick}>
						<div className='flex w-full flex-col items-start'>
							<div className='text-sm font-medium'>{t('backups-restore.browse-external-title')}</div>
							<div className='text-xs opacity-60'>{t('backups-restore.browse-external-subtitle')}</div>
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem disabled className='block cursor-not-allowed opacity-60'>
						<div className='flex w-full flex-col items-start'>
							<div className='text-sm font-medium'>{t('backups-restore.browse-cloud-title')}</div>
							<div className='text-xs opacity-60'>{t('backups-restore.browse-cloud-subtitle')}</div>
						</div>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* External storage unsupported dialog */}
			<AlertDialog open={showUnsupportedDialog} onOpenChange={setShowUnsupportedDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('files-external-storage.unsupported.title')}</AlertDialogTitle>
					</AlertDialogHeader>
					<div className='mt-2 flex justify-center'>
						<div className='relative'>
							<img src={externalStorageIcon} alt={t('external-drive')} className='size-16' draggable={false} />
							<div className='absolute -top-2 -right-2'>
								<TbAlertTriangleFilled className='size-8 text-yellow-400' />
							</div>
						</div>
					</div>
					<AlertDialogDescription className='text-center'>
						{t('files-external-storage.unsupported.description-general')}
					</AlertDialogDescription>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => setShowUnsupportedDialog(false)} hideEnterIcon>
							{t('ok')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
