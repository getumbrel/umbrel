import {useEffect, useState} from 'react'
// TODO: Consider changing TbBattery1 (low life) and TbHeartBroken (unhealthy) icons to something more intuitive
import {TbActivityHeartbeat, TbAlertTriangleFilled, TbBattery1, TbFlame, TbHeartBroken} from 'react-icons/tb'

import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {formatTemperature} from '@/utils/temperature'

import {getDeviceHealth, RaidDevice, raidStatusLabels, StorageDevice} from '../hooks/use-storage'
import {formatStorageSize} from '../utils'

type SsdShapeProps = {
	device: StorageDevice
	slotNumber: number
	onHealthClick: () => void
	minRoundedDriveSize: number
	raidType?: 'storage' | 'failsafe'
	temperatureUnit: 'c' | 'f'
	isReadyToAdd?: boolean
	/** RAID device info - undefined if device is not in RAID */
	raidDevice?: RaidDevice
}

export function SsdShape({
	device,
	slotNumber,
	onHealthClick,
	minRoundedDriveSize,
	raidType,
	temperatureUnit,
	isReadyToAdd = false,
	raidDevice,
}: SsdShapeProps) {
	// Check for RAID device failure (not ONLINE means the drive has issues in the RAID array)
	const isRaidDeviceFailed = raidDevice && raidDevice.raidStatus !== 'ONLINE'

	// Check for warnings
	const {hasWarning, smartUnhealthy, lifeWarning, lifeRemaining, tempWarning, tempCritical} = getDeviceHealth(device)

	// Combined warning state: health warnings OR RAID device failure
	const hasAnyWarning = hasWarning || isRaidDeviceFailed

	// Build array of active warnings for cycling
	// If RAID failure, only show that since any other warnings are not as important and can be seen in the health dialog
	type WarningType = 'temperature' | 'unhealthy' | 'lowLife' | 'raidFailed'
	const activeWarnings: WarningType[] = []
	if (isRaidDeviceFailed) {
		activeWarnings.push('raidFailed')
	} else {
		if (tempWarning || tempCritical) activeWarnings.push('temperature')
		if (smartUnhealthy) activeWarnings.push('unhealthy')
		if (lifeWarning) activeWarnings.push('lowLife')
	}

	// Cycle through warnings with fade transition
	const [currentWarningIndex, setCurrentWarningIndex] = useState(0)
	const [isVisible, setIsVisible] = useState(true)
	useEffect(() => {
		if (activeWarnings.length <= 1) return
		const interval = setInterval(() => {
			// Fade out
			setIsVisible(false)
			// After fade out, change warning and fade in
			setTimeout(() => {
				setCurrentWarningIndex((prev) => (prev + 1) % activeWarnings.length)
				setIsVisible(true)
			}, 200) // 200ms fade out duration
		}, 2000) // 3 seconds per warning
		return () => clearInterval(interval)
	}, [activeWarnings.length])

	const currentWarning = activeWarnings[currentWarningIndex % activeWarnings.length]

	// In failsafe mode, drives with larger roundedSize than the minimum have wasted space
	const wastedBytes =
		raidType === 'failsafe' && minRoundedDriveSize > 0 ? Math.max(0, device.roundedSize - minRoundedDriveSize) : 0
	const hasWastedSpace = wastedBytes > 0
	const usableSize = hasWastedSpace ? minRoundedDriveSize : device.roundedSize

	// Dimensions
	const width = 85
	const height = 340
	const notchRadius = 11
	const cornerRadius = 6
	const notchCenterX = width / 2

	// SVG path for SSD shape with bottom notch cut out
	const path = `
		M ${cornerRadius} 0
		H ${width - cornerRadius}
		Q ${width} 0 ${width} ${cornerRadius}
		V ${height - cornerRadius}
		Q ${width} ${height} ${width - cornerRadius} ${height}
		H ${notchCenterX + notchRadius}
		A ${notchRadius} ${notchRadius} 0 0 0 ${notchCenterX - notchRadius} ${height}
		H ${cornerRadius}
		Q 0 ${height} 0 ${height - cornerRadius}
		V ${cornerRadius}
		Q 0 0 ${cornerRadius} 0
		Z
	`

	// Gold fingers configuration
	const fingerCount = 29
	const fingerWidth = 2.5
	const fingerHeight = 16
	const keyNotchGap = 6 // Gap between main fingers and last 4 (M.2 key)
	const mainFingerCount = fingerCount - 4
	const keyFingerCount = 4
	const fingersWidth = fingerCount * fingerWidth + keyNotchGap
	const fingersStartX = (width - fingersWidth) / 2

	// Extend viewBox to include fingers above the SSD
	const viewBoxY = -fingerHeight
	const totalHeight = height + fingerHeight

	// Unique ID for gradient (needed when multiple SSDs on page)
	const gradientId = `ssd-gradient-${slotNumber}`

	return (
		<div className={cn('relative shrink-0', isReadyToAdd && 'animate-pulse')} style={{width, height: totalHeight}}>
			{/* SVG outline shape */}
			<svg
				className='absolute inset-0'
				width={width}
				height={totalHeight}
				viewBox={`0 ${viewBoxY} ${width} ${totalHeight}`}
				fill='none'
			>
				<defs>
					<linearGradient id={gradientId} x1='0%' y1='0%' x2='0%' y2='100%'>
						{isReadyToAdd ? (
							<>
								<stop offset='0%' stopColor='rgba(255, 255, 255, 0.15)' />
								<stop offset='100%' stopColor='rgba(255, 255, 255, 0.05)' />
							</>
						) : hasAnyWarning ? (
							<>
								<stop offset='0%' stopColor='#FF2F32' />
								<stop offset='100%' stopColor='#991C1E' />
							</>
						) : (
							<>
								<stop offset='0%' style={{stopColor: 'hsl(var(--color-brand) / 0)'}} />
								<stop offset='100%' style={{stopColor: 'hsl(var(--color-brand) / 0.1)'}} />
							</>
						)}
					</linearGradient>
					<linearGradient id={`finger-gradient-${slotNumber}`} x1='0%' y1='0%' x2='0%' y2='100%'>
						<stop offset='0%' stopColor='rgba(255, 255, 255, 0.12)' />
						<stop offset='100%' stopColor='rgba(255, 255, 255, 0)' />
					</linearGradient>
					<linearGradient id={`finger-stroke-${slotNumber}`} x1='0%' y1='0%' x2='0%' y2='100%'>
						<stop offset='0%' stopColor='rgba(255, 255, 255, 0.2)' />
						<stop offset='100%' stopColor='rgba(255, 255, 255, 0)' />
					</linearGradient>
				</defs>
				<path d={path} fill={`url(#${gradientId})`} stroke='rgba(255, 255, 255, 0.12)' strokeWidth='2' />
				{/* Gold fingers at top - outside the SSD */}
				{/* Main group of fingers */}
				{Array.from({length: mainFingerCount}).map((_, i) => (
					<rect
						key={i}
						x={fingersStartX + i * fingerWidth}
						y={-fingerHeight}
						width={fingerWidth}
						height={fingerHeight}
						rx={3}
						fill={`url(#finger-gradient-${slotNumber})`}
						stroke={`url(#finger-stroke-${slotNumber})`}
						strokeWidth={0.5}
					/>
				))}
				{/* Key fingers (last 4) with gap */}
				{Array.from({length: keyFingerCount}).map((_, i) => (
					<rect
						key={`key-${i}`}
						x={fingersStartX + mainFingerCount * fingerWidth + keyNotchGap + i * fingerWidth}
						y={-fingerHeight}
						width={fingerWidth}
						height={fingerHeight}
						rx={3}
						fill={`url(#finger-gradient-${slotNumber})`}
						stroke={`url(#finger-stroke-${slotNumber})`}
						strokeWidth={0.5}
					/>
				))}
			</svg>

			{/* Content overlay div */}
			<div
				className='absolute z-10 flex flex-col items-center justify-between rounded-[4px] border py-3'
				style={{
					top: fingerHeight + 20,
					left: 10,
					right: 10,
					bottom: 30,
					borderColor: isReadyToAdd
						? 'rgba(255, 255, 255, 0.2)'
						: hasAnyWarning
							? '#E22C2C'
							: 'hsl(var(--color-brand))',
					background: isReadyToAdd
						? 'linear-gradient(180deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.08) 100%)'
						: hasAnyWarning
							? 'linear-gradient(180deg, rgba(255, 255, 255, 0.37) 0%, rgba(255, 255, 255, 0.12) 100%)'
							: 'linear-gradient(177.39deg, hsl(var(--color-brand) / 0.48) 0.11%, hsl(var(--color-brand) / 0.12) 99.89%)',
				}}
			>
				{/* SSD Size - we show usable size, with actual size crossed out if wasted */}
				<div className='relative mt-4' style={{transform: 'rotate(-90deg)'}}>
					<span
						className='font-bold text-white'
						style={{
							fontSize: '25px',
							textShadow: '0px 0px 6px rgba(255, 255, 255, 0.25)',
						}}
					>
						{formatStorageSize(usableSize)}
					</span>
					{/* Crossed-out actual size - positioned below*/}
					{hasWastedSpace && (
						<span
							className='absolute font-bold text-white/40 line-through'
							style={{
								fontSize: '25px',
								right: '100%',
								top: '50%',
								transform: 'translateY(-50%)',
								marginRight: '16px',
							}}
						>
							{formatStorageSize(device.size)}
						</span>
					)}
				</div>

				{/* Warning indicators + Health pulse pill grouped together at bottom */}
				<div className='flex flex-col items-center gap-3'>
					{hasWastedSpace && (
						<span className='text-center text-[13px] font-medium leading-tight text-white/50'>
							{t('storage-manager.wasted-size', {size: formatStorageSize(wastedBytes)})}
						</span>
					)}

					{/* Cycling warning indicators */}
					{activeWarnings.length > 0 && (
						<div className='flex flex-col items-center gap-1'>
							<div
								className='flex flex-col items-center gap-0.5 transition-opacity duration-200'
								style={{opacity: isVisible ? 1 : 0}}
							>
								{currentWarning === 'raidFailed' && raidDevice && (
									<>
										<TbAlertTriangleFilled
											className='size-4 text-white'
											style={{
												filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))',
											}}
										/>
										<span className='text-[13px] font-bold text-white'>
											{raidStatusLabels[raidDevice.raidStatus]
												? t(raidStatusLabels[raidDevice.raidStatus])
												: raidDevice.raidStatus}
										</span>
									</>
								)}
								{currentWarning === 'temperature' && (
									<>
										<TbFlame
											className='size-4 text-white'
											style={{
												fill: 'currentColor',
												filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))',
											}}
										/>
										<span className='text-[13px] font-bold text-white'>
											{formatTemperature(device.temperature, temperatureUnit)}
										</span>
									</>
								)}
								{currentWarning === 'unhealthy' && (
									<>
										<TbHeartBroken
											className='size-4 text-white'
											style={{
												filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))',
											}}
										/>
										<span className='text-[13px] font-bold text-white'>{t('storage-manager.ssd-failing')}</span>
									</>
								)}
								{currentWarning === 'lowLife' && (
									<>
										<TbBattery1
											className='size-4 text-white'
											style={{
												filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))',
											}}
										/>
										<span className='text-[13px] font-bold text-white'>{lifeRemaining}%</span>
									</>
								)}
							</div>
							{/* Carousel dots - only show if multiple warnings */}
							{activeWarnings.length > 1 && (
								<div className='flex gap-1'>
									{activeWarnings.map((_, index) => (
										<span
											key={index}
											className='size-1 rounded-full transition-opacity duration-200'
											style={{
												backgroundColor: 'white',
												opacity: index === currentWarningIndex ? 1 : 0.3,
											}}
										/>
									))}
								</div>
							)}
						</div>
					)}

					{/* Health pulse pill */}
					<button
						type='button'
						onClick={onHealthClick}
						className='relative flex cursor-pointer items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] px-4 py-1 transition-colors hover:bg-white/[0.12]'
					>
						<TbActivityHeartbeat className='size-4 text-white' />
						{/* Warning dot - upper right of pill */}
						{hasAnyWarning && (
							<span
								className='absolute'
								style={{
									top: '-2px',
									right: '-2px',
									width: '10px',
									height: '10px',
								}}
							>
								{/* Solid center dot */}
								<span className='absolute inset-0 rounded-full bg-white' />
								{/* Expanding ping ring */}
								<span className='absolute inset-0 animate-ping rounded-full bg-white opacity-75' />
							</span>
						)}
					</button>
				</div>
			</div>
		</div>
	)
}
