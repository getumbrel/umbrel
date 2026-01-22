// TODO: Consider moving to shared location (e.g., @/features/storage/) when implementing RAID settings in dashboard

import {useState} from 'react'
import {TbActivityHeartbeat, TbAlertTriangle} from 'react-icons/tb'

import {FadeScroller} from '@/components/fade-scroller'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/shadcn-components/ui/dialog'
import {tw} from '@/utils/tw'

import {formatSize, getDeviceHealth, StorageDevice} from './use-raid-setup'

type Warning = {
	message: string
	advice: string
}

type SsdHealthDialogProps = {
	device: StorageDevice
	slotNumber: number
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function SsdHealthDialog({device, slotNumber, open, onOpenChange}: SsdHealthDialogProps) {
	// Get health status from shared helper
	const {smartUnhealthy, lifeRemaining, lifeWarning, tempWarning, tempCritical} = getDeviceHealth(device)

	// Determine health status display label
	const healthStatus =
		device.smartStatus === 'healthy' ? 'Healthy' : device.smartStatus === 'unhealthy' ? 'Unhealthy' : 'Unknown'

	// Collect all warnings for this device
	const warnings: Warning[] = []

	if (smartUnhealthy) {
		warnings.push({
			message: 'Drive is reporting unhealthy status',
			advice: 'This drive may fail soon. Consider using a different drive if available.',
		})
	}

	if (lifeWarning) {
		warnings.push({
			message: `Only ${lifeRemaining}% estimated life remaining`,
			advice: 'Consider using a different drive if available.',
		})
	}

	if (tempCritical) {
		warnings.push({
			message: `Temperature is critical (${device.temperature}°C)`,
			advice: 'Ensure Umbrel Pro has adequate ventilation and the drive is properly seated.',
		})
	} else if (tempWarning) {
		warnings.push({
			message: `Drive is overheating (${device.temperature}°C)`,
			advice: 'Ensure Umbrel Pro has adequate ventilation and the drive is properly seated.',
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogScrollableContent showClose>
				<div className='space-y-5 px-5 py-6'>
					<DialogHeader>
						<div className='flex items-center gap-2'>
							<TbActivityHeartbeat className='size-5' />
							<DialogTitle>SSD Health</DialogTitle>
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
						{/* Overlay text */}
						{/* Left side - Size and Slot */}
						<div className='absolute flex flex-col' style={{left: '20%', top: '50%', transform: 'translateY(-50%)'}}>
							<span
								className='font-bold leading-tight'
								style={{
									fontSize: 'clamp(20px, 5vw, 30px)',
									textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)',
								}}
							>
								{formatSize(device.size)}
							</span>
							<span className='text-white/50' style={{fontSize: 'clamp(12px, 2.5vw, 14px)'}}>
								SSD {slotNumber}
							</span>
						</div>
						{/* Right side - Model */}
						<span
							className='absolute font-medium text-white/90'
							style={{right: '5%', top: '70%', transform: 'translateY(-50%)', fontSize: 'clamp(12px, 2.5vw, 15px)'}}
						>
							{device.model}
						</span>
					</div>

					{/* Warnings Section - only shown if there are warnings */}
					{warnings.length > 0 && (
						<div className='rounded-12 border border-[#F5A623]/30 bg-[#F5A623]/10 p-4'>
							<div className='mb-3 flex items-center gap-2 text-[#F5A623]'>
								<TbAlertTriangle className='size-5' />
								<span className='font-semibold'>Warnings</span>
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
						<span className='text-xs font-medium uppercase tracking-wider text-white/40'>General</span>
						{/* Model and serial use select-all for easy copying */}
						<div className={listClass}>
							<div className={listItemClass}>
								<span className='shrink-0'>Model &amp; capacity</span>
								<FadeScroller direction='x' className='umbrel-hide-scrollbar min-w-0 overflow-x-auto font-normal'>
									<span className='select-all whitespace-nowrap'>{device.model}</span>
									<span className='whitespace-nowrap'> · {formatSize(device.size)}</span>
								</FadeScroller>
							</div>
							<div className={listItemClass}>
								<span className='shrink-0'>Serial number</span>
								<FadeScroller direction='x' className='umbrel-hide-scrollbar min-w-0 overflow-x-auto font-normal'>
									<span className='select-all whitespace-nowrap'>{device.serial}</span>
								</FadeScroller>
							</div>
						</div>
					</div>

					{/* Wear Section */}
					<div className='space-y-2'>
						<span className='text-xs font-medium uppercase tracking-wider text-white/40'>Wear</span>
						<div className={listClass}>
							<div className={listItemClass}>
								<span>Health status</span>
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
									<span>Estimated life remaining</span>
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
										{lifeRemaining}%{lifeWarning && ' · Low'}
									</span>
								</div>
							)}
						</div>
					</div>

					{/* Temperature Section */}
					{device.temperature !== undefined && (
						<div className='space-y-2'>
							<span className='text-xs font-medium uppercase tracking-wider text-white/40'>Temperature</span>
							<div className={listClass}>
								<div className={listItemClass}>
									<span>Current temperature</span>
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
										{device.temperature}°C
										{tempCritical && ' · Critical'}
										{tempWarning && ' · Overheating'}
									</span>
								</div>
								{device.temperatureWarning !== undefined && (
									<div className={listItemClass}>
										<span>Warning threshold</span>
										<span className='font-normal'>{device.temperatureWarning}°C</span>
									</div>
								)}
								{device.temperatureCritical !== undefined && (
									<div className={listItemClass}>
										<span>Critical threshold</span>
										<span className='font-normal'>{device.temperatureCritical}°C</span>
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
export function useSsdHealthDialog() {
	const [selectedDevice, setSelectedDevice] = useState<{device: StorageDevice; slotNumber: number} | null>(null)

	return {
		selectedDevice,
		open: selectedDevice !== null,
		onOpenChange: (open: boolean) => {
			if (!open) setSelectedDevice(null)
		},
		openDialog: (device: StorageDevice, slotNumber: number) => {
			setSelectedDevice({device, slotNumber})
		},
	}
}
