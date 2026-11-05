import {useId} from 'react'
import {Trans, useTranslation} from 'react-i18next'

import {getDeviceHealth, StorageDevice} from '../hooks/use-storage'
import {formatStorageSize} from '../utils'
import {HardDriveIcon, SsdChip} from './list-manager/drive-visuals'

// These drives are visible for health checks, but have no Add action in this setup.
export function OtherDrives({
	drives,
	description,
	onHealthClick,
}: {
	drives: StorageDevice[]
	description: React.ReactNode
	onHealthClick: (device: StorageDevice) => void
}) {
	const {t} = useTranslation()
	const titleId = useId()
	if (drives.length === 0) return null

	return (
		<section aria-labelledby={titleId} className='flex flex-col gap-2.5'>
			<div className='flex flex-col gap-1'>
				<h2 id={titleId} className='text-13 font-semibold text-white/50'>
					{t('storage-manager.other-drives')}
				</h2>
				<div className='space-y-2 text-13 leading-relaxed text-white/50'>{description}</div>
			</div>
			{drives.map((device) => (
				<button
					key={device.id}
					type='button'
					onClick={() => onHealthClick(device)}
					className='flex w-full items-center gap-4 rounded-12 bg-white/5 p-4 text-left transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-hidden'
				>
					{device.type === 'hdd' ? (
						<HardDriveIcon led={getDeviceHealth(device).hasWarning ? 'red' : 'none'} />
					) : (
						<SsdChip
							sizeLabel={formatStorageSize(device.size)}
							led={getDeviceHealth(device).hasWarning ? 'red' : 'none'}
						/>
					)}
					<span className='min-w-0 flex-1'>
						<span className='block truncate text-[15px] font-medium text-white'>{device.name}</span>
						<span className='block truncate text-13 text-white/50'>
							{formatStorageSize(device.size)} · {device.serial}
						</span>
					</span>
				</button>
			))}
		</section>
	)
}

export function StorageMigrationDescription({
	variant,
	hasMixedDrives = false,
}: {
	variant: 'single-drive' | 'hdd'
	hasMixedDrives?: boolean
}) {
	const {t} = useTranslation()
	return (
		<>
			<p>
				<Trans
					t={t}
					i18nKey={
						variant === 'hdd' ? 'storage-manager.other-drives.ssd-pool' : 'storage-manager.other-drives.single-drive'
					}
					components={{
						download: (
							<a
								href='https://umbrel.com/downloads'
								target='_blank'
								rel='noopener noreferrer'
								className='text-white/80 underline decoration-white/40 underline-offset-2 hover:text-white'
							/>
						),
					}}
				/>
			</p>
			{variant === 'hdd' ? (
				<p>{t('storage-manager.other-drives.ssd-pool-acceleration')}</p>
			) : hasMixedDrives ? (
				<p>{t('storage-manager.other-drives.mixed-types')}</p>
			) : null}
		</>
	)
}
