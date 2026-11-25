import {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {ChevronDown} from '@/components/chevron-down'
import {AnimatedNumber} from '@/components/ui/animated-number'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {temperatureDescriptionsKeyed, TemperatureUnit, useTemperatureUnit} from '@/hooks/use-temperature-unit'
import {cn} from '@/lib/utils'
import {isCpuTooHot} from '@/utils/system'
import {celciusToFahrenheit, formatTemperature, temperatureWarningToMessage} from '@/utils/temperature'

import {cardErrorClass} from './shared'

export function CpuTemperatureCardContent({
	temperatureInCelcius,
	defaultUnit,
	warning,
	headerIcon,
}: {
	temperatureInCelcius?: number
	defaultUnit?: TemperatureUnit
	warning?: string
	headerIcon?: ReactNode
}) {
	const {t} = useTranslation()
	const [unit, setUnit] = useTemperatureUnit(defaultUnit)

	const temperatureNumber = unit === 'c' ? temperatureInCelcius : celciusToFahrenheit(temperatureInCelcius)
	const temperatureUnitLabel = temperatureDescriptionsKeyed[unit].label
	const temperatureMessage = temperatureNumber === 69 ? t('temperature.nice') : temperatureWarningToMessage(warning)

	const isUnknown = temperatureNumber === undefined

	const scaleMinCelcius = 35
	const scaleMaxCelcius = 100
	const indicatorPosition =
		temperatureInCelcius === undefined
			? undefined
			: Math.max(
					5,
					Math.min(95, ((temperatureInCelcius - scaleMinCelcius) / (scaleMaxCelcius - scaleMinCelcius)) * 100),
				)

	// When the status and the temperature don't share a line, the temperature
	// moves under the status, whole, rather than either being cut
	const compactValue = (className?: string) => (
		<span className={cn('-mr-2 flex min-w-0 flex-wrap items-center gap-x-1 font-medium', className)}>
			<span className='flex min-w-0 items-center gap-1'>
				<span className='text-white/45'>{temperatureMessage}</span>
				<span className='text-white/30'>•</span>
			</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type='button'
						aria-label={`${t('cpu-temperature')}: ${temperatureNumber ?? '--'}${temperatureUnitLabel}`}
						className='group flex shrink-0 items-center gap-1 rounded-4 whitespace-nowrap text-white outline-hidden transition-colors hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/20'
					>
						<span>
							{isUnknown ? '--' : <AnimatedNumber to={temperatureNumber} />}
							{temperatureUnitLabel}
						</span>
						<span className='shrink-0 text-white/30 transition-colors group-hover:text-white/60'>
							<ChevronDown />
						</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					<DropdownMenuCheckboxItem checked={unit === 'c'} onSelect={() => setUnit('c')}>
						{t('temperature.celsius')} ({temperatureDescriptionsKeyed.c.label})
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem checked={unit === 'f'} onSelect={() => setUnit('f')}>
						{t('temperature.fahrenheit')} ({temperatureDescriptionsKeyed.f.label})
					</DropdownMenuCheckboxItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</span>
	)

	return (
		<div className={cn('flex flex-col', headerIcon ? 'gap-3' : 'gap-4')}>
			{headerIcon ? (
				<>
					<div className='flex min-w-0 items-start justify-between gap-3 text-13 -tracking-2'>
						<span className='min-w-0 truncate font-semibold text-white/45'>{t('cpu-temperature')}</span>
						{headerIcon}
					</div>
					<div className='flex justify-start text-13 -tracking-2'>{compactValue()}</div>
				</>
			) : (
				// A value that doesn't fit beside its title moves under it
				<div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-13 -tracking-2'>
					<span className='truncate font-semibold text-white/45'>{t('cpu-temperature')}</span>
					{compactValue('ml-auto')}
				</div>
			)}
			<div className='relative pt-[5px]'>
				{indicatorPosition !== undefined && (
					<div
						className='absolute top-0 size-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent border-t-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-[left] duration-700'
						style={{left: `${indicatorPosition}%`}}
					/>
				)}
				<div
					className='h-2 rounded-full border shadow-[0_0_16px_hsl(var(--color-brand)/0.24)]'
					style={{
						background:
							'linear-gradient(90deg, hsl(var(--settings-tone-cold)), hsl(var(--color-brand)), hsl(var(--settings-tone-hot)))',
						borderColor: 'hsl(var(--settings-tone-temperature-border))',
					}}
				/>
				<div
					aria-hidden='true'
					className='pointer-events-none absolute inset-x-0 bottom-full -mb-[3px] text-11 -tracking-2 text-white/30 opacity-0 transition-opacity duration-200 group-hover/temperature-card:opacity-100 motion-reduce:transition-none'
				>
					<span className='absolute bottom-0 left-0 -translate-x-1/2'>{formatTemperature(scaleMinCelcius, unit)}</span>
					<span className='absolute right-0 bottom-0 translate-x-1/2'>{formatTemperature(scaleMaxCelcius, unit)}</span>
				</div>
			</div>
			{isCpuTooHot(warning) && <span className={cardErrorClass}>{t('temperature.too-hot-suggestion')}</span>}
		</div>
	)
}
