import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {TbPlus, TbShieldOff} from 'react-icons/tb'

import {cn} from '@/lib/utils'

import {getDeviceHealth, RaidDevice, RaidDeviceStatus, raidStatusLabels, StorageDevice} from '../../hooks/use-storage'
import {formatStorageSize, hasRaidErrors} from '../../utils'
import {HardDriveIcon} from './drive-visuals'

// Badge rendered between the two halves of a pair card
function PairBadge({variant}: {variant: 'protected' | 'broken' | 'add'}) {
	return (
		<div
			className={cn(
				'absolute top-1/2 left-1/2 z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-lg',
				variant === 'protected' && 'bg-brand text-white',
				variant === 'broken' && 'bg-[#FF3434] text-white',
				variant === 'add' && 'bg-white/15 text-white backdrop-blur-sm',
			)}
		>
			{variant === 'broken' ? <TbShieldOff className='size-4' /> : <IoShieldHalf className='size-4' />}
		</div>
	)
}

// One half of a pair card showing a drive (centered layout per the FailSafe designs)
export function PairDriveCell({
	device,
	raidDevice,
	inactive,
	onClick,
	action,
}: {
	device: StorageDevice
	raidDevice?: RaidDevice
	inactive?: boolean
	onClick?: () => void
	action?: React.ReactNode
}) {
	const {t} = useTranslation()
	const {hasWarning} = getDeviceHealth(device)
	const isFailed = raidDevice && raidDevice.raidStatus !== 'ONLINE'
	const led = inactive || isFailed || hasWarning ? 'red' : hasRaidErrors(raidDevice) ? 'amber' : 'green'

	return (
		<div
			onClick={onClick}
			className={cn(
				'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-4 py-5 sm:px-10 sm:py-6',
				onClick && 'cursor-pointer transition-colors hover:bg-white/5',
			)}
		>
			{inactive && (
				<span className='absolute top-2 left-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/60'>
					{t('storage-manager.inactive')}
				</span>
			)}
			<HardDriveIcon led={led} />
			<div className='flex w-full min-w-0 flex-col items-center gap-0.5 text-center'>
				<span className='max-w-full truncate text-[15px] font-medium text-white' title={device.name}>
					{device.name}
				</span>
				<span className='max-w-full truncate text-13 text-white/50' title={device.serial}>
					{formatStorageSize(device.size)} · {device.serial}
				</span>
				{isFailed && raidDevice && (
					<span className='text-[12px] font-medium text-[#FF3434]'>
						{raidStatusLabels[raidDevice.raidStatus]
							? t(raidStatusLabels[raidDevice.raidStatus])
							: raidDevice.raidStatus}
					</span>
				)}
			</div>
			{action}
		</div>
	)
}

// One half of a pair card for a pool member whose physical drive is gone
export function PairMissingCell({
	id,
	status,
	action,
}: {
	id: string
	status?: RaidDeviceStatus
	action?: React.ReactNode
}) {
	const {t} = useTranslation()
	return (
		<div className='relative flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-4 py-5 sm:px-10 sm:py-6'>
			<HardDriveIcon led='red' className='opacity-40' />
			<div className='flex w-full min-w-0 flex-col items-center gap-0.5 text-center'>
				<span className='max-w-full truncate text-[15px] font-medium text-white'>
					{t('storage-manager.missing-drive')}
				</span>
				{/* Device ids are MODEL_SERIAL and can get long; cap the width like a healthy cell's
				    subtitle and truncate from the start so the serial (the part that identifies the
				    physical drive) stays visible */}
				<span dir='rtl' className='max-w-full truncate text-13 text-white/50' title={id}>
					{id}
				</span>
				<span className='text-[12px] font-medium text-[#FF3434]'>
					{status && raidStatusLabels[status] ? t(raidStatusLabels[status]) : t('storage-manager.raid-status.removed')}
				</span>
			</div>
			{action}
		</div>
	)
}

// One half of a pair card prompting the user to attach a partner drive
export function PairPlaceholderCell({title, description}: {title: string; description: string}) {
	return (
		<div className='flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-4 py-5 text-center sm:px-10 sm:py-6'>
			<div className='flex size-8 items-center justify-center rounded-full bg-white/10'>
				<TbPlus className='size-4 text-white/80' strokeWidth={2.5} />
			</div>
			<div className='flex flex-col gap-0.5'>
				<span className='text-[14px] font-medium text-balance text-white'>{title}</span>
				<span className='text-[12px] leading-snug text-white/50'>{description}</span>
			</div>
		</div>
	)
}

// Card holding two halves of a mirrored pair with a badge in the middle.
// `broken` renders the red dashed style used for unpaired/inactive drives.
export function PairCard({
	left,
	right,
	badge,
	broken,
}: {
	left: React.ReactNode
	right: React.ReactNode
	badge: 'protected' | 'broken' | 'add' | React.ReactNode
	broken?: boolean
}) {
	const isNamedBadge = badge === 'protected' || badge === 'broken' || badge === 'add'
	return (
		<div
			className={cn(
				'relative flex w-full overflow-hidden rounded-12',
				broken ? 'border border-dashed border-[#FF3434]/50 bg-[#FF3434]/5' : 'bg-white/5',
			)}
		>
			<div className={cn('flex min-w-0 flex-1', broken && 'rounded-l-12 bg-[#3C1C1C]/40')}>{left}</div>
			<div className={cn('w-px self-stretch', broken ? 'bg-[#FF3434]/30' : 'bg-white/10')} />
			<div className='flex min-w-0 flex-1'>{right}</div>
			{isNamedBadge ? <PairBadge variant={badge as 'protected' | 'broken' | 'add'} /> : badge}
		</div>
	)
}
