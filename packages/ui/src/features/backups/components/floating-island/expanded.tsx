import {useTranslation} from 'react-i18next'

import {ScrollArea} from '@/components/ui/scroll-area'
import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {ProgressRing, ProgressRingBadge} from '@/modules/floating-island/progress-ring'

type Progress = {name: string; percent: number; path?: string}

export function ExpandedContent({progresses}: {progresses: Progress[]}) {
	const {t} = useTranslation()
	// Single backup - show circular progress
	if (progresses.length === 1) {
		const progress = progresses[0]

		return (
			<div className='flex size-full items-center justify-between gap-4 overflow-hidden px-8 py-6'>
				{/* Left side */}
				<div className='flex min-w-0 flex-col gap-1'>
					<div className='truncate text-sm tracking-tight text-white/90'>
						{t('backups-floating-island.backing-up-to')}
					</div>
					<div className='truncate text-xs font-normal text-white/50'>{progress.name}</div>
					<div className='mt-2 flex items-baseline gap-1'>
						<div className='text-5xl font-light tracking-tight text-white'>{progress.percent.toFixed(0)}</div>
						<div className='font-medium text-white/40'>%</div>
					</div>
				</div>

				<ProgressRing percent={progress.percent}>
					<ProgressRingBadge>
						{progress.path ? (
							<BackupDeviceIcon path={progress.path} className='size-12 p-1' />
						) : (
							<div className='size-12' />
						)}
					</ProgressRingBadge>
				</ProgressRing>
			</div>
		)
	}

	// Multiple backups - show list view
	return (
		<div className='flex h-full w-full flex-col overflow-hidden py-5'>
			<div className='mb-4 flex items-center justify-between px-5'>
				<span className='text-xs text-white/60'>{t('backups-floating-island.backing-up-to')}</span>
			</div>

			<ScrollArea className='flex-1 px-5 pb-1'>
				<div className='space-y-3'>
					{progresses.map((p) => (
						<div key={p.name} className='flex items-center gap-3'>
							{p.path ? (
								<BackupDeviceIcon path={p.path} className='size-7 shrink-0' />
							) : (
								<div className='size-6 shrink-0' />
							)}
							<div className='min-w-0 flex-1'>
								<div className='flex items-center justify-between text-xs text-white/70'>
									<span className='truncate'>{p.name}</span>
									<span className='shrink-0 text-white/60'>{p.percent.toFixed(0)}%</span>
								</div>
								<div className='relative mt-1 h-1 overflow-hidden rounded-full bg-white/20'>
									<div
										className='absolute top-0 left-0 h-full rounded-full bg-brand transition-all duration-300'
										style={{width: `${p.percent}%`}}
									/>
								</div>
							</div>
						</div>
					))}
				</div>
			</ScrollArea>
		</div>
	)
}
