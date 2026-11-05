import {useTranslation} from 'react-i18next'
import {TiInfoLarge} from 'react-icons/ti'

import {cn} from '@/lib/utils'

import {getDeviceHealth, type StorageDevice} from '../hooks/use-storage'
import {formatStorageSize} from '../utils'
import {DriveIcon, HardDriveIcon, SsdChip} from './list-manager/drive-visuals'

// A missing member keeps its stable identity even when physical metadata is gone.
// Status is supplied by the caller: physical health cannot establish pool health.
export function StorageDeviceCard({
	device,
	fallbackType,
	name,
	identifier,
	role,
	status,
	onDetails,
}: {
	device?: StorageDevice
	// Use only when the hardware identifies the media without physical metadata.
	fallbackType?: StorageDevice['type']
	name?: string
	identifier?: string
	role?: React.ReactNode
	status?: React.ReactNode
	onDetails?: () => void
}) {
	const {t} = useTranslation()
	const warning = device && getDeviceHealth(device).hasWarning
	const type = device?.type ?? fallbackType
	const label = name ?? device?.name ?? t('storage-status.drive')
	const metadata = device
		? [formatStorageSize(device.roundedSize ?? device.size), device.serial].filter(Boolean).join(' · ')
		: identifier
	return (
		<div className='flex w-full min-w-0 items-center gap-3 rounded-xl bg-white/5 p-3.5'>
			{type === 'ssd' ? (
				<SsdChip
					sizeLabel={device ? formatStorageSize(device.roundedSize ?? device.size) : 'SSD'}
					led={warning ? 'amber' : 'none'}
					className={cn(!device && 'opacity-50')}
				/>
			) : type === 'hdd' ? (
				<HardDriveIcon
					led={warning ? 'amber' : 'none'}
					className={cn(device?.smartStatus !== 'healthy' && !warning && 'grayscale')}
				/>
			) : (
				<DriveIcon className='opacity-50 grayscale' />
			)}
			<div className='min-w-0 flex-1'>
				<div className='truncate text-[15px] font-medium text-white' title={label}>
					{label}
				</div>
				{metadata && (
					<div className='truncate text-13 text-white/40' title={metadata}>
						{metadata}
					</div>
				)}
				{(role || status || warning) && (
					<div className={cn('mt-1 text-12', warning ? 'text-[#F5A623]' : 'text-white/50')}>
						{[role, status, warning ? t('raid-error.health-warning') : undefined].filter(Boolean).map((item, index) => (
							<span key={index}>
								{index > 0 && ' · '}
								{item}
							</span>
						))}
					</div>
				)}
			</div>
			{onDetails && (
				<button
					type='button'
					onClick={onDetails}
					aria-label={t('storage-status.drive-details', {name: label})}
					className='flex size-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white'
				>
					<TiInfoLarge className='size-4' />
				</button>
			)}
		</div>
	)
}
