import {useEffect, useId, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TiInfoLarge} from 'react-icons/ti'

import {cn} from '@/lib/utils'

import {RaidDevice, StorageDevice} from '../hooks/use-storage'
import {formatStorageSize, getSsdCapacity} from '../utils'
import {describeSsdWarning, getSsdSeverity, getSsdWarnings} from './ssd-warnings'

type SsdShapeProps = {
	device: StorageDevice
	onHealthClick: () => void
	minRoundedDriveSize: number
	raidType?: 'storage' | 'failsafe'
	temperatureUnit: 'c' | 'f'
	isReadyToAdd?: boolean
	/** Overrides the "New SSD detected" caption, e.g. "Ready to replace SSD 2" */
	readyToAddLabel?: string
	/** RAID device info - undefined if device is not in RAID */
	raidDevice?: RaidDevice
}

export function SsdShape({
	device,
	onHealthClick,
	minRoundedDriveSize,
	raidType,
	temperatureUnit,
	isReadyToAdd = false,
	readyToAddLabel,
	raidDevice,
}: SsdShapeProps) {
	const {t} = useTranslation()
	const activeWarnings = getSsdWarnings(device, raidDevice)
	const severity = getSsdSeverity(device, raidDevice)
	const hasCriticalWarning = severity === 'critical'
	const hasAmberWarning = severity === 'attention'
	const hasAnyWarning = !!severity

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
	const warningDisplay = currentWarning && describeSsdWarning(currentWarning, {device, raidDevice, temperatureUnit, t})

	const {wastedBytes, usableSize} = getSsdCapacity(device, raidType, minRoundedDriveSize)
	const hasWastedSpace = wastedBytes > 0

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

	// Fixed teal for freshly detected SSDs: sits between green and blue so it stands out
	// against the wallpaper-driven brand color no matter which way the theme leans.
	const readyToAddRgb = '45, 212, 191'

	// Unique IDs are needed when an arbitrary number of SSD shapes share the page.
	const visualId = useId()
	const gradientId = `${visualId}-ssd-gradient`
	const fingerGradientId = `${visualId}-finger-gradient`
	const fingerStrokeId = `${visualId}-finger-stroke`

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
								<stop offset='0%' stopColor={`rgba(${readyToAddRgb}, 0)`} />
								<stop offset='100%' stopColor={`rgba(${readyToAddRgb}, 0.1)`} />
							</>
						) : hasCriticalWarning ? (
							<>
								<stop offset='0%' stopColor='#FF2F32' />
								<stop offset='100%' stopColor='#991C1E' />
							</>
						) : hasAmberWarning ? (
							<>
								<stop offset='0%' stopColor='#F5A623' />
								<stop offset='100%' stopColor='#8C5D14' />
							</>
						) : (
							<>
								<stop offset='0%' style={{stopColor: 'hsl(var(--color-brand) / 0)'}} />
								<stop offset='100%' style={{stopColor: 'hsl(var(--color-brand) / 0.1)'}} />
							</>
						)}
					</linearGradient>
					<linearGradient id={fingerGradientId} x1='0%' y1='0%' x2='0%' y2='100%'>
						<stop offset='0%' stopColor='rgba(255, 255, 255, 0.12)' />
						<stop offset='100%' stopColor='rgba(255, 255, 255, 0)' />
					</linearGradient>
					<linearGradient id={fingerStrokeId} x1='0%' y1='0%' x2='0%' y2='100%'>
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
						fill={`url(#${fingerGradientId})`}
						stroke={`url(#${fingerStrokeId})`}
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
						fill={`url(#${fingerGradientId})`}
						stroke={`url(#${fingerStrokeId})`}
						strokeWidth={0.5}
					/>
				))}
			</svg>

			{/* Content overlay div */}
			<div
				className='absolute z-10 flex flex-col items-center gap-3 rounded-[4px] border py-3'
				style={{
					top: fingerHeight + 20,
					left: 10,
					right: 10,
					bottom: 30,
					borderColor: isReadyToAdd
						? `rgb(${readyToAddRgb})`
						: hasCriticalWarning
							? '#E22C2C'
							: hasAmberWarning
								? '#F5A623'
								: 'hsl(var(--color-brand))',
					background: isReadyToAdd
						? `linear-gradient(177.39deg, rgba(${readyToAddRgb}, 0.48) 0.11%, rgba(${readyToAddRgb}, 0.12) 99.89%)`
						: hasCriticalWarning
							? 'linear-gradient(180deg, rgba(255, 255, 255, 0.37) 0%, rgba(255, 255, 255, 0.12) 100%)'
							: hasAmberWarning
								? 'linear-gradient(180deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)'
								: 'linear-gradient(177.39deg, hsl(var(--color-brand) / 0.48) 0.11%, hsl(var(--color-brand) / 0.12) 99.89%)',
				}}
			>
				{/* Reserve the footer's height; only the secondary vertical text may shrink. */}
				<div
					className='mt-1 flex min-h-0 flex-1 items-center justify-end gap-3'
					style={{writingMode: 'vertical-rl', transform: 'rotate(180deg)'}}
				>
					{hasWastedSpace && (
						<span className='shrink-0 text-[18px] font-bold whitespace-nowrap text-white/40 line-through'>
							{formatStorageSize(device.size)}
						</span>
					)}
					{isReadyToAdd && (
						<span
							className='min-h-0 overflow-hidden text-[12px] font-semibold text-ellipsis whitespace-nowrap text-white/50'
							title={readyToAddLabel ?? t('storage-manager.new-ssd-detected')}
						>
							{readyToAddLabel ?? t('storage-manager.new-ssd-detected')}
						</span>
					)}
					<span
						className='shrink-0 font-bold whitespace-nowrap text-white'
						style={{
							fontSize: '25px',
							textShadow: '0px 0px 6px rgba(255, 255, 255, 0.25)',
						}}
					>
						{formatStorageSize(usableSize)}
					</span>
				</div>

				{/* Warning indicators + Health pulse pill grouped together at bottom */}
				<div className='flex w-full shrink-0 flex-col items-center gap-2 px-1'>
					{hasWastedSpace && (
						<span className='w-full text-center text-[11px] leading-tight font-medium break-words text-white/50'>
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
								{warningDisplay && (
									<>
										<warningDisplay.icon
											className={cn('size-4 text-white', currentWarning === 'temperature' && 'fill-current')}
											style={{filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))'}}
										/>
										<span className='text-center text-[13px] font-bold text-white'>{warningDisplay.label}</span>
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
						aria-label={t('storage-status.drive-details', {name: device.name})}
						className='relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] p-1.5 transition-colors hover:bg-white/[0.12]'
					>
						<TiInfoLarge className='size-4 text-white' />
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
