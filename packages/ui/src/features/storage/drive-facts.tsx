// What is known about one drive: only what the drive itself reports. A drive that doesn't
// report its health is "Unknown", not healthy, and life left is shown only for SSDs that
// measure it.

import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'
import {formatTemperature} from '@/utils/temperature'

import {Drive, troubleOf} from './model'
import {Note, Row, Rows} from './parts'
import {forKind} from './words'

export type TemperatureUnit = 'c' | 'f'

const amber = 'font-medium text-[#F5A623]'
const red = 'font-medium text-[#FF6B6B]'

export function DriveFacts({
	drive,
	use,
	status,
	statusTone,
	unit = 'c',
}: {
	drive: Drive
	// What the drive is used for, in words, where that is known
	use?: string
	// How the storage sees the drive, when it is part of one. Otherwise its own health is shown.
	status?: string
	statusTone?: 'good' | 'attention' | 'critical'
	unit?: TemperatureUnit
}) {
	const {t} = useTranslation()
	const trouble = troubleOf(drive)
	const {temperature, temperatureWarning, temperatureCritical, lifetimeUsed} = drive
	const overCritical = trouble === 'critical'
	const overWarning = trouble === 'hot'
	const health =
		drive.smart === 'unhealthy'
			? t('storage-ui.health.failing')
			: drive.smart === 'unknown'
				? t('storage-ui.health.unknown')
				: t('storage-ui.health.healthy')
	return (
		<Rows>
			<Row
				label={t('storage-ui.fact.status')}
				value={
					<span
						className={cn(
							(statusTone ?? (drive.smart === 'unhealthy' ? 'attention' : 'good')) === 'critical' && red,
							(statusTone ?? (drive.smart === 'unhealthy' ? 'attention' : 'good')) === 'attention' && amber,
						)}
					>
						{status ?? health}
					</span>
				}
			/>
			{use && <Row label={t('storage-ui.fact.use')} value={use} />}
			{!drive.absent && temperature !== undefined && (
				<Row
					label={t('storage-ui.fact.temperature')}
					value={
						overCritical || overWarning ? (
							<span className={overCritical ? red : amber}>
								{t('storage-ui.temperature.over-limit', {
									temperature: formatTemperature(temperature, unit),
									limit: formatTemperature(overCritical ? temperatureCritical : temperatureWarning, unit),
								})}
							</span>
						) : (
							formatTemperature(temperature, unit)
						)
					}
				/>
			)}
			{!drive.absent && lifetimeUsed !== undefined && (
				<Row
					label={t('storage-ui.fact.life-left')}
					value={
						<span className={cn(trouble === 'worn' && amber)}>{Math.max(0, 100 - Math.round(lifetimeUsed))}%</span>
					}
				/>
			)}
			{drive.errors ? (
				<Row
					label={t('storage-ui.fact.errors')}
					value={<span className={amber}>{t('storage-ui.errors-corrected', {count: drive.errors})}</span>}
				/>
			) : null}
			{drive.model && <Row label={t('storage-ui.fact.model')} value={drive.model} />}
			{drive.serial && (
				<Row label={t('storage-ui.fact.serial')} value={<span className='font-mono text-12'>{drive.serial}</span>} />
			)}
		</Rows>
	)
}

// What to do about a drive that is too warm. A drive over its critical limit is more than a
// nuisance: it protects itself by slowing down, and heat is what wears it out.
export function TemperatureAdvice({drive, isPro}: {drive: Drive; isPro: boolean}) {
	const {t: plainT} = useTranslation()
	const t = forKind(plainT, drive.kind)
	const trouble = troubleOf(drive)
	if (trouble !== 'hot' && trouble !== 'critical') return null
	return (
		<Note tone={trouble === 'critical' ? 'danger' : 'warning'}>
			{trouble === 'critical' ? t('storage-ui.temperature.critical-lead') : t('storage-ui.temperature.hot-lead')}{' '}
			{isPro ? t('storage-ui.temperature.advice-pro') : t('storage-ui.temperature.advice')}
		</Note>
	)
}
