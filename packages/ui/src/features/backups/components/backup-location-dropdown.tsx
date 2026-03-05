import {ChevronDown} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {t} from '@/utils/i18n'

type RestoreLocationDropdownProps = {
	onSelect: (root: string) => void
}

export function RestoreLocationDropdown({onSelect}: RestoreLocationDropdownProps) {
	return (
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
				<DropdownMenuItem className='block' onSelect={() => onSelect('/Network')}>
					<div className='flex w-full flex-col items-start'>
						<div className='text-sm font-medium'>{t('backups-restore.browse-nas-title')}</div>
						<div className='text-xs opacity-60'>{t('backups-restore.browse-nas-subtitle')}</div>
					</div>
				</DropdownMenuItem>
				<DropdownMenuItem className='block' onSelect={() => onSelect('/External')}>
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
	)
}
