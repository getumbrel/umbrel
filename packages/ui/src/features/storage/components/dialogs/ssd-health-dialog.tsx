import {useState} from 'react'
import {TbActivityHeartbeat, TbAlertTriangle, TbAlertTriangleFilled} from 'react-icons/tb'

import {FadeScroller} from '@/components/fade-scroller'
import {useTemperatureUnit} from '@/hooks/use-temperature-unit'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/shadcn-components/ui/dialog'
import {t} from '@/utils/i18n'
import {formatTemperature} from '@/utils/temperature'
import {tw} from '@/utils/tw'

import {getDeviceHealth, RaidDevice, raidStatusLabels, StorageDevice} from '../../hooks/use-storage'
import {formatStorageSize} from '../../utils'

type Warning = {
	message: string
	advice: string
}

type SsdHealthDialogProps = {
	device: StorageDevice
	slotNumber: number
	open: boolean
	onOpenChange: (open: boolean) => void
	/** RAID device info - undefined if device is not in RAID */
	raidDevice?: RaidDevice
}

export function SsdHealthDialog({device, slotNumber, open, onOpenChange, raidDevice}: SsdHealthDialogProps) {
	const {smartUnhealthy, lifeRemaining, lifeWarning, tempWarning, tempCritical} = getDeviceHealth(device)
	const [temperatureUnit] = useTemperatureUnit()

	const healthStatus =
		device.smartStatus === 'healthy'
			? t('storage-manager.health.status-healthy')
			: device.smartStatus === 'unhealthy'
				? t('storage-manager.health.status-unhealthy')
				: t('storage-manager.health.status-unknown')

	// Check if drive has failed in RAID
	const isRaidFailed = raidDevice && raidDevice.raidStatus !== 'ONLINE'

	const warnings: Warning[] = []

	if (smartUnhealthy) {
		warnings.push({
			message: t('storage-manager.health.warning-unhealthy-message'),
			advice: t('storage-manager.health.warning-unhealthy-advice'),
		})
	}

	if (lifeWarning) {
		warnings.push({
			message: t('storage-manager.health.warning-life-message', {percent: lifeRemaining}),
			advice: t('storage-manager.health.warning-life-advice'),
		})
	}

	if (tempCritical) {
		warnings.push({
			message: t('storage-manager.health.warning-temp-critical', {
				temperature: formatTemperature(device.temperature, temperatureUnit),
			}),
			advice: t('storage-manager.health.warning-temp-advice'),
		})
	} else if (tempWarning) {
		warnings.push({
			message: t('storage-manager.health.warning-temp-overheating', {
				temperature: formatTemperature(device.temperature, temperatureUnit),
			}),
			advice: t('storage-manager.health.warning-temp-advice'),
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogScrollableContent showClose>
				<div className='select-none space-y-5 px-5 py-6'>
					<DialogHeader>
						<div className='flex items-center gap-2'>
							<TbActivityHeartbeat className='size-5' />
							<DialogTitle>{t('storage-manager.health.title')}</DialogTitle>
						</div>
					</DialogHeader>

					{/* SSD Depiction */}
					<div
						className='relative -mr-5'
						style={{
							maskImage: 'linear-gradient(to right, black 60%, transparent 100%)',
							WebkitMaskImage: 'linear-gradient(to right, black 60%, transparent 100%)',
						}}
					>
						<img src='/onboarding/ssd-info.webp' alt='SSD' draggable={false} className='ml-auto w-[95%]' />
						<div className='absolute flex flex-col' style={{left: '20%', top: '50%', transform: 'translateY(-50%)'}}>
							<span
								className='font-bold leading-tight'
								style={{
									fontSize: 'clamp(20px, 5vw, 30px)',
									textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)',
								}}
							>
								{formatStorageSize(device.size)}
							</span>
							<span className='text-white/50' style={{fontSize: 'clamp(12px, 2.5vw, 14px)'}}>
								SSD {slotNumber}
							</span>
						</div>
						<span
							className='absolute font-medium text-white/90'
							style={{right: '5%', top: '70%', transform: 'translateY(-50%)', fontSize: 'clamp(12px, 2.5vw, 15px)'}}
						>
							{device.model}
						</span>
					</div>

					{/* RAID Status Section - shown when drive status is not ONLINE */}
					{isRaidFailed && raidDevice && (
						<div className='rounded-12 border border-[#FF3434]/30 bg-[#FF3434]/10 p-4'>
							<div className='mb-3 flex items-center gap-2 text-[#FF3434]'>
								<TbAlertTriangleFilled className='size-5' />
								<span className='font-semibold'>
									Status:{' '}
									{raidStatusLabels[raidDevice.raidStatus]
										? t(raidStatusLabels[raidDevice.raidStatus])
										: raidDevice.raidStatus}
								</span>
							</div>
							<div className='text-sm'>
								<p className='font-medium text-white/90'>{t('storage-manager.health.raid-failed-advice')}</p>
								{(raidDevice.readErrors > 0 || raidDevice.writeErrors > 0 || raidDevice.checksumErrors > 0) && (
									<div className='mt-3 flex gap-4 text-xs text-white/40'>
										<span>{t('storage-manager.health.read-errors', {count: raidDevice.readErrors})}</span>
										<span>{t('storage-manager.health.write-errors', {count: raidDevice.writeErrors})}</span>
										<span>{t('storage-manager.health.checksum-errors', {count: raidDevice.checksumErrors})}</span>
									</div>
								)}
							</div>
						</div>
					)}

					{/* Warnings Section */}
					{warnings.length > 0 && (
						<div className='rounded-12 border border-[#F5A623]/30 bg-[#F5A623]/10 p-4'>
							<div className='mb-3 flex items-center gap-2 text-[#F5A623]'>
								<TbAlertTriangle className='size-5' />
								<span className='font-semibold'>{t('storage-manager.health.warnings')}</span>
							</div>
							<div className='divide-y divide-[#F5A623]/20'>
								{warnings.map((warning, index) => (
									<div key={index} className='py-2 text-sm first:pt-0 last:pb-0'>
										<p className='font-medium text-white/90'>{warning.message}</p>
										<p className='mt-0.5 text-white/50'>{warning.advice}</p>
									</div>
								))}
							</div>
						</div>
					)}

					{/* General Section */}
					<div className='space-y-2'>
						<span className='text-xs font-medium uppercase tracking-wider text-white/40'>
							{t('storage-manager.health.general')}
						</span>
						<div className={listClass}>
							<div className={listItemClass}>
								<span className='shrink-0'>{t('storage-manager.health.model-and-capacity')}</span>
								<FadeScroller direction='x' className='umbrel-hide-scrollbar min-w-0 overflow-x-auto font-normal'>
									<span className='select-all whitespace-nowrap'>{device.model}</span>
									<span className='whitespace-nowrap'> · {formatStorageSize(device.size)}</span>
								</FadeScroller>
							</div>
							<div className={listItemClass}>
								<span className='shrink-0'>{t('storage-manager.health.serial-number')}</span>
								<FadeScroller direction='x' className='umbrel-hide-scrollbar min-w-0 overflow-x-auto font-normal'>
									<span className='select-all whitespace-nowrap'>{device.serial}</span>
								</FadeScroller>
							</div>
						</div>
					</div>

					{/* Wear Section */}
					<div className='space-y-2'>
						<span className='text-xs font-medium uppercase tracking-wider text-white/40'>
							{t('storage-manager.health.wear')}
						</span>
						<div className={listClass}>
							<div className={listItemClass}>
								<span>{t('storage-manager.health.health-status')}</span>
								<span className='flex items-center gap-2 font-normal'>
									<span
										className='size-[5px] rounded-full ring-3'
										style={
											{
												backgroundColor:
													device.smartStatus === 'healthy'
														? '#00D084'
														: device.smartStatus === 'unhealthy'
															? '#F5A623'
															: 'rgba(255,255,255,0.5)',
												'--tw-ring-color':
													device.smartStatus === 'healthy'
														? 'rgba(0, 208, 132, 0.3)'
														: device.smartStatus === 'unhealthy'
															? 'rgba(245, 166, 35, 0.3)'
															: 'rgba(255, 255, 255, 0.15)',
											} as React.CSSProperties
										}
									/>
									{healthStatus}
								</span>
							</div>
							{lifeRemaining !== undefined && (
								<div className={listItemClass}>
									<span>{t('storage-manager.health.estimated-life')}</span>
									<span className='flex items-center gap-2 font-normal'>
										{lifeWarning && (
											<span
												className='size-[5px] rounded-full ring-3'
												style={
													{
														backgroundColor: '#F5A623',
														'--tw-ring-color': 'rgba(245, 166, 35, 0.3)',
													} as React.CSSProperties
												}
											/>
										)}
										{lifeRemaining}%{lifeWarning && ` · ${t('storage-manager.health.low')}`}
									</span>
								</div>
							)}
						</div>
					</div>

					{/* Temperature Section */}
					{device.temperature !== undefined && (
						<div className='space-y-2'>
							<span className='text-xs font-medium uppercase tracking-wider text-white/40'>
								{t('storage-manager.health.temperature')}
							</span>
							<div className={listClass}>
								<div className={listItemClass}>
									<span>{t('storage-manager.health.current-temperature')}</span>
									<span className='flex items-center gap-2 font-normal'>
										<span
											className='size-[5px] rounded-full ring-3'
											style={
												{
													backgroundColor: tempCritical ? '#FF2F63' : tempWarning ? '#F5A623' : '#00D084',
													'--tw-ring-color': tempCritical
														? 'rgba(255, 47, 99, 0.3)'
														: tempWarning
															? 'rgba(245, 166, 35, 0.3)'
															: 'rgba(0, 208, 132, 0.3)',
												} as React.CSSProperties
											}
										/>
										{formatTemperature(device.temperature, temperatureUnit)}
										{tempCritical && ` · ${t('storage-manager.health.critical')}`}
										{tempWarning && ` · ${t('storage-manager.health.overheating')}`}
									</span>
								</div>
								{device.temperatureWarning !== undefined && (
									<div className={listItemClass}>
										<span>{t('storage-manager.health.warning-threshold')}</span>
										<span className='font-normal'>{formatTemperature(device.temperatureWarning, temperatureUnit)}</span>
									</div>
								)}
								{device.temperatureCritical !== undefined && (
									<div className={listItemClass}>
										<span>{t('storage-manager.health.critical-threshold')}</span>
										<span className='font-normal'>
											{formatTemperature(device.temperatureCritical, temperatureUnit)}
										</span>
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}

const listClass = tw`divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6`
const listItemClass = tw`flex items-center gap-3 px-3 h-[42px] text-14 font-medium -tracking-3 justify-between text-white/90`

// Hook to manage SSD health dialog state
// Stores deviceId instead of device object so parent can look up fresh data
export function useSsdHealthDialog() {
	const [selectedDevice, setSelectedDevice] = useState<{deviceId: string; slotNumber: number} | null>(null)

	return {
		selectedDevice,
		open: selectedDevice !== null,
		onOpenChange: (open: boolean) => {
			if (!open) setSelectedDevice(null)
		},
		openDialog: (device: StorageDevice, slotNumber: number) => {
			if (!device.id) return
			setSelectedDevice({deviceId: device.id, slotNumber})
		},
	}
}
