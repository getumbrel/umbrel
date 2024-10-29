import {AnimatedNumber} from '@/components/ui/animated-number'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {
	temperatureDescriptions,
	temperatureDescriptionsKeyed,
	TemperatureUnit,
	useTemperatureUnit,
} from '@/hooks/use-temperature-unit'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {isCpuTooHot} from '@/utils/system'
import {celciusToFahrenheit, temperatureWarningToColor, temperatureWarningToMessage} from '@/utils/temperature'

import {cardErrorClass, cardSecondaryValueClass, cardTitleClass, cardValueClass} from './shared'

export function CpuTemperatureCardContent({
	temperatureInCelcius,
	defaultUnit,
	warning,
}: {
	temperatureInCelcius?: number
	defaultUnit?: TemperatureUnit
	warning?: string
}) {
	const [unit, setUnit] = useTemperatureUnit(defaultUnit)

	const temperatureNumber = unit === 'c' ? temperatureInCelcius : celciusToFahrenheit(temperatureInCelcius)
	const temperatureUnitLabel = temperatureDescriptionsKeyed[unit].label
	const temperatureMessage = temperatureNumber === 69 ? t('temperature.nice') : temperatureWarningToMessage(warning)

	// 60% opacity to base 16
	const opacity = (60).toString(16)
	const isUnknown = temperatureNumber === undefined

	const isMobile = useIsMobile()

	return (
		<div className='flex flex-col gap-4'>
			<div className={cardTitleClass}>{t('temperature')}</div>
			<div className='flex flex-wrap-reverse items-center justify-between gap-2'>
				<div className='flex shrink-0 flex-col gap-2.5'>
					<div className={cardValueClass}>
						{isUnknown ? '--' : <AnimatedNumber to={temperatureNumber} />} {temperatureUnitLabel}
					</div>
					<div className='flex items-center gap-2'>
						<div
							className={cn('h-[5px] w-[5px] rounded-full ring-3', !isUnknown && 'animate-pulse')}
							style={
								{
									backgroundColor: temperatureWarningToColor(warning),
									'--tw-ring-color': temperatureWarningToColor(warning) + opacity,
								} as React.CSSProperties // forcing because of `--tw-ring-color`
							}
						/>
						<div className={cn(cardSecondaryValueClass, 'leading-inter-trimmed')}>{temperatureMessage}</div>
					</div>
				</div>
				<SegmentedControl
					size={isMobile ? 'sm' : 'default'}
					variant='primary'
					tabs={temperatureDescriptions}
					value={unit}
					onValueChange={setUnit}
				/>
			</div>
			{isCpuTooHot(warning) && <span className={cardErrorClass}>{t('temperature.too-hot-suggestion')}</span>}
		</div>
	)
}
