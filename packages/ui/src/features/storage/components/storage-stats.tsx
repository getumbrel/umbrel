import {useTranslation} from 'react-i18next'
import {TbAlertTriangleFilled} from 'react-icons/tb'

import {cn} from '@/lib/utils'

import {formatStorageSize} from '../utils'

// Simple divider for storage info section
const StorageDivider = () => <div className='h-px w-2/3 bg-linear-to-r from-transparent via-white/15 to-transparent' />

// Storage stats display - shared between the Pro and list-based storage managers
export function StorageStats({
	isLoading,
	totalCapacityBytes,
	availableBytes,
	failsafeOverheadBytes,
	wastedBytes,
	inactiveBytes = 0,
	totalLabel,
	availableLabel,
}: {
	isLoading: boolean
	totalCapacityBytes: number
	availableBytes: number
	failsafeOverheadBytes: number
	wastedBytes: number
	/** Total size of attached drives that aren't part of the pool (list-based manager only) */
	inactiveBytes?: number
	/** Overrides the "Total capacity added" label (e.g. plain "Total capacity" on single-drive devices) */
	totalLabel?: string
	/** Overrides the "Available storage" label (e.g. "Free space" on single-drive devices) */
	availableLabel?: string
}) {
	const {t} = useTranslation()
	return (
		<div className='flex w-full flex-col items-center'>
			{/* Total capacity */}
			<div className='py-2.5 text-center'>
				<div className={cn('text-16 font-semibold text-white', isLoading && 'animate-pulse text-white/30')}>
					{isLoading ? '—' : formatStorageSize(totalCapacityBytes)}
				</div>
				<div className='text-13 font-semibold text-white/50'>
					{totalLabel ?? t('storage-manager.total-capacity-added')}
				</div>
			</div>

			<StorageDivider />

			{/* Available storage */}
			<div className='py-2.5 text-center'>
				<div className={cn('text-16 font-semibold text-white', isLoading && 'animate-pulse text-white/30')}>
					{isLoading ? '—' : formatStorageSize(availableBytes)}
				</div>
				<div className='flex items-center justify-center gap-1.5'>
					<span className='size-2 rounded-full bg-brand' />
					<span className='text-13 font-semibold text-white/50'>
						{availableLabel ?? t('storage-manager.available-storage')}
					</span>
				</div>
			</div>

			{/* FailSafe - hide entirely when loading */}
			{!isLoading && failsafeOverheadBytes > 0 && (
				<>
					<StorageDivider />
					<div className='py-2.5 text-center'>
						<div className='text-16 font-semibold text-white'>{formatStorageSize(failsafeOverheadBytes)}</div>
						<div className='flex items-center justify-center gap-1.5'>
							<span
								className='size-2 rounded-full'
								style={{backgroundColor: 'color-mix(in srgb, hsl(var(--color-brand)), white 60%)'}}
							/>
							<span className='text-13 font-semibold text-white/50'>{t('storage-manager.for-failsafe')}</span>
						</div>
					</div>
				</>
			)}

			{/* Wasted - hide entirely when loading */}
			{!isLoading && wastedBytes > 0 && (
				<>
					<StorageDivider />
					<div className='py-2.5 text-center'>
						<div className='text-16 font-semibold text-white'>{formatStorageSize(wastedBytes)}</div>
						<div className='flex items-center justify-center gap-1.5'>
							<TbAlertTriangleFilled className='size-3.5 text-[#F5A623]' />
							<span className='text-13 font-semibold text-white/50'>{t('storage-manager.wasted')}</span>
						</div>
					</div>
				</>
			)}

			{/* Inactive & unused drives - hide entirely when loading */}
			{!isLoading && inactiveBytes > 0 && (
				<>
					<StorageDivider />
					<div className='py-2.5 text-center'>
						<div className='text-16 font-semibold text-white'>{formatStorageSize(inactiveBytes)}</div>
						<div className='flex items-center justify-center gap-1.5'>
							<TbAlertTriangleFilled className='size-3.5 text-[#FF3434]' />
							<span className='text-13 font-semibold text-white/50'>{t('storage-manager.inactive-and-unused')}</span>
						</div>
					</div>
				</>
			)}
		</div>
	)
}
