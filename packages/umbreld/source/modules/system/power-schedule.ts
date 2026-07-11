import type Umbreld from '../../index.js'
import {reboot, shutdown} from './system.js'

type PowerAction = 'shutdown' | 'restart'

export type PowerSchedule = {
	shutdown: {
		enabled: boolean
		time: string
	}
	restart: {
		enabled: boolean
		time: string
	}
}

const DEFAULT_TIME = '00:00'
const TIME_REGEX = /^\d{2}:\d{2}$/

const defaultSchedule: PowerSchedule = {
	shutdown: {enabled: false, time: DEFAULT_TIME},
	restart: {enabled: false, time: DEFAULT_TIME},
}

let shutdownTimer: NodeJS.Timeout | null = null
let restartTimer: NodeJS.Timeout | null = null

function isValidTime(value: string) {
	if (!TIME_REGEX.test(value)) return false
	const [hours, minutes] = value.split(':').map((part) => Number(part))
	if (Number.isNaN(hours) || Number.isNaN(minutes)) return false
	return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

function normalizeTime(value: string | undefined) {
	if (value && isValidTime(value)) return value
	return DEFAULT_TIME
}

export function normalizePowerSchedule(input?: Partial<PowerSchedule> | null): PowerSchedule {
	return {
		shutdown: {
			enabled: input?.shutdown?.enabled ?? defaultSchedule.shutdown.enabled,
			time: normalizeTime(input?.shutdown?.time),
		},
		restart: {
			enabled: input?.restart?.enabled ?? defaultSchedule.restart.enabled,
			time: normalizeTime(input?.restart?.time),
		},
	}
}

function getNextOccurrence(time: string, now = new Date()) {
	const [hours, minutes] = time.split(':').map((part) => Number(part))
	const next = new Date(now)
	next.setSeconds(0, 0)
	next.setHours(hours, minutes, 0, 0)
	if (next.getTime() <= now.getTime()) {
		next.setDate(next.getDate() + 1)
	}
	return next
}

function clearTimer(timer: NodeJS.Timeout | null) {
	if (timer) clearTimeout(timer)
}

function scheduleAction(umbreld: Umbreld, action: PowerAction, config: PowerSchedule[PowerAction]) {
	const logger = umbreld.logger.createChildLogger('power-schedule')
	const nextRun = getNextOccurrence(config.time)
	const delayMs = Math.max(0, nextRun.getTime() - Date.now())

	logger.log(`${action} scheduled for ${nextRun.toISOString()}`)

	return setTimeout(async () => {
		try {
			await umbreld.stop()
			if (action === 'shutdown') {
				await shutdown()
			} else {
				await reboot()
			}
		} catch (error) {
			logger.error(`Failed scheduled ${action}`, error)
		}
	}, delayMs)
}

export function schedulePowerSchedule(umbreld: Umbreld, schedule: PowerSchedule) {
	clearTimer(shutdownTimer)
	clearTimer(restartTimer)

	shutdownTimer = schedule.shutdown.enabled ? scheduleAction(umbreld, 'shutdown', schedule.shutdown) : null
	restartTimer = schedule.restart.enabled ? scheduleAction(umbreld, 'restart', schedule.restart) : null
}

export async function getPowerSchedule(umbreld: Umbreld) {
	const stored = await umbreld.store.get('settings.powerSchedule')
	return normalizePowerSchedule(stored)
}

export async function setPowerSchedule(umbreld: Umbreld, schedule: PowerSchedule) {
	await umbreld.store.set('settings.powerSchedule', schedule)
	schedulePowerSchedule(umbreld, schedule)
	return true
}

export async function initializePowerSchedule(umbreld: Umbreld) {
	const schedule = await getPowerSchedule(umbreld)
	schedulePowerSchedule(umbreld, schedule)
}

export function stopPowerSchedule() {
	clearTimer(shutdownTimer)
	clearTimer(restartTimer)
	shutdownTimer = null
	restartTimer = null
}
