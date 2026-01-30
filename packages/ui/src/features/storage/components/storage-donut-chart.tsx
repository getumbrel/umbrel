import {TbAlertTriangleFilled} from 'react-icons/tb'
import {Cell, Label, Pie, PieChart} from 'recharts'

import {t} from '@/utils/i18n'
import {maybePrettyBytes} from '@/utils/pretty-bytes'

type StorageDonutChartProps = {
	used: number
	available: number
	failsafe: number
	wasted: number
	usedBytes?: number // Raw bytes for center label formatting
	hideCenter?: boolean // Hide center label (for preview charts)
	isLoading?: boolean // Show skeleton loading state
}

export function StorageDonutChart({
	used,
	available,
	failsafe,
	wasted,
	usedBytes,
	hideCenter,
	isLoading,
}: StorageDonutChartProps) {
	const size = 140
	const innerRadius = 50
	const outerRadius = 70

	// Loading skeleton state - we show empty gray ring with pulse animation
	if (isLoading) {
		const LoadingCenterLabel = ({viewBox}: {viewBox?: {cx?: number; cy?: number}}) => {
			const {cx = 0, cy = 0} = viewBox || {}
			return (
				<text x={cx} y={cy} textAnchor='middle' dominantBaseline='central' className='animate-pulse'>
					<tspan x={cx} dy='-0.3em' fill='rgba(255,255,255,0.3)' fontSize='16' fontWeight='bold'>
						—
					</tspan>
					<tspan x={cx} dy='1.5em' fill='rgba(255,255,255,0.3)' fontSize='13'>
						{t('storage-manager.used')}
					</tspan>
				</text>
			)
		}

		return (
			<div className='[&_*]:outline-none [&_*]:focus:outline-none' style={{pointerEvents: 'none'}} tabIndex={-1}>
				<PieChart width={size} height={size} style={{cursor: 'default'}} tabIndex={-1}>
					<Pie
						data={[{name: 'loading', value: 1, color: 'rgba(255, 255, 255, 0.1)'}]}
						cx='50%'
						cy='50%'
						innerRadius={innerRadius}
						outerRadius={outerRadius}
						paddingAngle={0}
						dataKey='value'
						startAngle={90}
						endAngle={-270}
						cornerRadius={4}
						stroke='none'
						isAnimationActive={false}
						activeIndex={-1}
						className='animate-pulse'
					>
						<Cell fill='rgba(255, 255, 255, 0.1)' style={{outline: 'none', cursor: 'default'}} />
						{!hideCenter && <Label content={<LoadingCenterLabel />} position='center' />}
					</Pie>
				</PieChart>
			</div>
		)
	}

	// Colors
	const BRAND_COLOR = 'hsl(var(--color-brand))'
	// FailSafe: brand color with 60% white overlay = lighter version
	const BRAND_LIGHT = 'color-mix(in srgb, hsl(var(--color-brand)), white 60%)'
	const WASTED_COLOR = '#F5A623'
	const USED_COLOR = 'rgba(255, 255, 255, 0.8)'

	// Outer ring: capacity breakdown (available, failsafe overhead, wasted)
	const capacityData = [
		{name: 'wasted', value: wasted, color: WASTED_COLOR},
		{name: 'failsafe', value: failsafe, color: BRAND_LIGHT},
		{name: 'available', value: available, color: BRAND_COLOR},
	].filter((d) => d.value > 0)

	// Inner ring: "used" overlay positioned within the "available" segment (with 2% inset from edges)
	const total = wasted + failsafe + available
	const inset = total * 0.02
	const usedData = [
		{name: 'spacer', value: wasted + failsafe + inset, color: 'transparent'},
		{name: 'used', value: Math.max(0, used - inset), color: USED_COLOR},
		{name: 'free', value: Math.max(0, available - used), color: 'transparent'},
	]

	// Custom center label component - uses same formatting as Settings/Live Usage
	const CenterLabel = ({viewBox}: {viewBox?: {cx?: number; cy?: number}}) => {
		const {cx = 0, cy = 0} = viewBox || {}
		const usedDisplay = maybePrettyBytes(usedBytes ?? 0)
		return (
			<text x={cx} y={cy} textAnchor='middle' dominantBaseline='central'>
				<tspan x={cx} dy='-0.3em' fill='white' fontSize='16' fontWeight='bold'>
					{usedDisplay}
				</tspan>
				<tspan x={cx} dy='1.5em' fill='rgba(255,255,255,0.5)' fontSize='13'>
					{t('storage-manager.used')}
				</tspan>
			</text>
		)
	}

	// Calculate position for warning icon in the middle of wasted segment
	const center = size / 2
	const midRadius = (innerRadius + outerRadius) / 2
	// Wasted segment starts at 90 degrees and spans clockwise
	const wastedDegrees = (wasted / total) * 360
	const wastedMidAngle = 90 - wastedDegrees / 2 // Center of wasted segment
	const wastedMidRad = (wastedMidAngle * Math.PI) / 180
	const warningX = center + midRadius * Math.cos(wastedMidRad)
	const warningY = center - midRadius * Math.sin(wastedMidRad)

	return (
		<div className='[&_*]:outline-none [&_*]:focus:outline-none' style={{pointerEvents: 'none'}} tabIndex={-1}>
			<PieChart width={size} height={size} style={{cursor: 'default'}} tabIndex={-1}>
				{/* Outer ring: capacity breakdown */}
				<Pie
					data={capacityData}
					cx='50%'
					cy='50%'
					innerRadius={innerRadius}
					outerRadius={outerRadius}
					paddingAngle={4}
					dataKey='value'
					startAngle={90}
					endAngle={-270}
					cornerRadius={4}
					stroke='none'
					isAnimationActive={false}
					activeIndex={-1}
				>
					{capacityData.map((entry, index) => (
						<Cell key={`capacity-${index}`} fill={entry.color} style={{outline: 'none', cursor: 'default'}} />
					))}
					{!hideCenter && <Label content={<CenterLabel />} position='center' />}
				</Pie>

				{/* Inner ring: "used" overlay on the available segment */}
				<Pie
					data={usedData}
					cx='50%'
					cy='50%'
					innerRadius={innerRadius + 4}
					outerRadius={outerRadius - 4}
					paddingAngle={0}
					dataKey='value'
					startAngle={90}
					endAngle={-270}
					cornerRadius={4}
					stroke='none'
					isAnimationActive={false}
					activeIndex={-1}
				>
					{usedData.map((entry, index) => (
						<Cell key={`used-${index}`} fill={entry.color} style={{outline: 'none', cursor: 'default'}} />
					))}
				</Pie>

				{/* Warning icon in wasted segment */}
				{wasted > 0 && (
					<foreignObject x={warningX - 8} y={warningY - 8} width={16} height={16}>
						<TbAlertTriangleFilled className='size-4 text-white' />
					</foreignObject>
				)}
			</PieChart>
		</div>
	)
}
