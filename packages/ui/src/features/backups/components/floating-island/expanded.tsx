import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {t} from '@/utils/i18n'

type Progress = {name: string; percent: number; path?: string}

export function ExpandedContent({progresses}: {progresses: Progress[]}) {
	return (
		<div className='flex size-full flex-col overflow-hidden py-5'>
			<div className='mb-4 flex items-center justify-between px-5'>
				<span className='text-xs text-white/60'>{t('backups-floating-island.backing-up-to')}</span>
			</div>

			<div className='flex-1 px-5 pb-2'>
				<div className='space-y-3 overflow-y-auto'>
					{progresses.map((p) => (
						<div key={p.name} className='flex items-center gap-3'>
							{p.path ? (
								<BackupDeviceIcon path={p.path} className='size-7 flex-shrink-0' />
							) : (
								<div className='size-6 flex-shrink-0' />
							)}
							<div className='min-w-0 flex-1'>
								<div className='flex items-center justify-between text-xs text-white/70'>
									<span className='truncate'>{p.name}</span>
									<span className='shrink-0 text-white/60'>{p.percent.toFixed(0)}%</span>
								</div>
								<div className='relative mt-1 h-1 overflow-hidden rounded-full bg-white/20'>
									<div
										className='absolute left-0 top-0 h-full rounded-full bg-brand transition-all duration-300'
										style={{width: `${p.percent}%`}}
									/>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
