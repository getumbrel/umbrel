// We reuse this dropdown for both the:
// - Restore wizard accessed via settings
// - Restore flow during onboarding

import {ChevronDown} from 'lucide-react'

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
}

export function RestoreLocationDropdown({onSelect}: RestoreLocationDropdownProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type='button'
					size='sm'
					className='absolute right-5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1'
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
				<DropdownMenuItem className='block cursor-pointer' onSelect={() => onSelect('/External')}>
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
