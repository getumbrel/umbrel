import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'

import {RaidDevice, StorageDevice} from '../hooks/use-storage'
import {formatStorageSize, getSsdCapacity} from '../utils'
import {SsdCard} from './ssd-card'
import {describeSsdWarning, getSsdSeverity, getSsdWarnings} from './ssd-warnings'

// One SSD in the Storage Manager on hardware without a known layout. It's the same drive
// the user saw during setup, carrying everything worth knowing on a single line.
export function SsdRow({
	device,
	raidDevice,
	minRoundedDriveSize,
	raidType,
	temperatureUnit,
	isReadyToAdd = false,
	readyToAddLabel,
	onHealthClick,
	action,
}: {
	device: StorageDevice
	raidDevice?: RaidDevice
	minRoundedDriveSize: number
	raidType?: 'storage' | 'failsafe'
	temperatureUnit: 'c' | 'f'
	isReadyToAdd?: boolean
	/** Overrides the "New SSD detected" caption, e.g. "Replacement for SSD 2" */
	readyToAddLabel?: string
	onHealthClick: () => void
	action?: React.ReactNode
}) {
	const {t} = useTranslation()
	const warnings = getSsdWarnings(device, raidDevice)
	const severity = getSsdSeverity(device, raidDevice)
	const {usableSize, wastedBytes} = getSsdCapacity(device, raidType, minRoundedDriveSize)

	return (
		<SsdCard
			size={formatStorageSize(usableSize)}
			model={[device.name, device.serial].filter(Boolean).join(' · ')}
			variant={isReadyToAdd ? 'new' : (severity ?? 'storage')}
			onInfoClick={onHealthClick}
			infoLabel={t('storage-status.drive-details', {name: device.name})}
			status={
				<span className='flex min-w-0 items-center gap-2 text-[12px] font-semibold whitespace-nowrap'>
					{wastedBytes > 0 && <span className='text-white/40 line-through'>{formatStorageSize(device.size)}</span>}
					{isReadyToAdd && (
						<span className='min-w-0 truncate text-[#2DD4BF]'>
							{readyToAddLabel ?? t('storage-manager.new-ssd-detected')}
						</span>
					)}
					{warnings.map((warning) => {
						const {icon: Icon, label} = describeSsdWarning(warning, {device, raidDevice, temperatureUnit, t})
						return (
							<span key={warning} className='flex shrink-0 items-center gap-1 text-white'>
								<Icon className={cn('size-3.5', warning === 'temperature' && 'fill-current')} />
								{label}
							</span>
						)
					})}
					{wastedBytes > 0 && (
						<span className='min-w-0 truncate text-white/50'>
							{t('storage-manager.wasted-size', {size: formatStorageSize(wastedBytes)})}
						</span>
					)}
				</span>
			}
			action={action}
		/>
	)
}
