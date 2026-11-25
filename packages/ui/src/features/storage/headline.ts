// What umbrelOS says about the storage outside Storage Manager: the toast when it opens, the
// mark on Settings, the Storage Manager row, the notification after a storage check. Each is
// worded by the code Storage Manager itself leads with, so the story is the same wherever it
// is read.

import type {TFunction} from 'i18next'

import type {StatusTone} from './art'
import {TaskRecord, toDrive, toStorageState} from './from-umbreld'
import type {RaidProgress} from './hooks/use-raid-progress'
import type {RaidStatus, StorageDevice} from './hooks/use-storage'
import {getStatus} from './manager/status'
import {getSingleStatus, SingleHost} from './single-status'
import {StorageState, viewPool} from './state'

export type Headline = {
	tone: StatusTone
	title: string
	body: string
	// The running task's one number, 0 to 100
	progress?: number
	// Something is wrong, as opposed to under way or simply so
	alarming: boolean
	// It is about running out of space, which umbrelOS also raises on its own
	space?: boolean
	// Data a storage check couldn't repair
	damaged?: boolean
}

// The task umbreld's own status says is running. Events report it as it happens, and this is
// for a reader that has none to go by.
export function progressFromStatus(raid: RaidStatus): RaidProgress | null {
	const transition = raid.failsafeTransitionStatus
	if (transition && transition.state !== 'error' && transition.state !== 'complete') {
		return {type: 'failsafe-transition', state: transition.state, progress: transition.progress}
	}
	if (raid.replace?.state === 'rebuilding')
		return {type: 'replace', state: 'rebuilding', progress: raid.replace.progress}
	if (raid.rebuild?.state === 'rebuilding')
		return {type: 'rebuild', state: 'rebuilding', progress: raid.rebuild.progress}
	if (raid.expansion?.state === 'expanding') {
		return {type: 'expansion', state: 'expanding', progress: raid.expansion.progress}
	}
	if (raid.scrub?.state === 'scrubbing') return {type: 'scrub', state: 'scrubbing', progress: raid.scrub.progress}
	return null
}

const alarmingTone = (tone: StatusTone) => tone === 'attention' || tone === 'critical'

export function getHeadline({
	raid,
	devices,
	isPro,
	host = 'unknown',
	state,
	t,
	locale,
}: {
	raid: RaidStatus | undefined
	devices: StorageDevice[] | undefined
	isPro: boolean
	// What umbrelOS runs on, where it keeps everything on one drive
	host?: SingleHost
	// The storage as Storage Manager has already read it. Left out, it is read here from what
	// umbreld's status alone says.
	state?: StorageState | null
	t: TFunction
	locale: string
}): Headline | null {
	if (!raid || !devices) return null

	if (raid.exists) {
		const read =
			state === undefined
				? toStorageState({
						raid,
						devices,
						isPro,
						progress: progressFromStatus(raid),
						record: null as TaskRecord | null,
						failsafeError:
							raid.failsafeTransitionStatus?.state === 'error' ? raid.failsafeTransitionStatus.error : null,
					})
				: state
		// A storage umbreld reports but that can't be told apart as SSDs or hard drives
		if (!read) {
			return {
				tone: 'attention',
				title: t('storage-single.unreadable.unidentified.title'),
				body: t('storage-single.unreadable.unidentified.body'),
				alarming: true,
			}
		}
		const status = getStatus(read, viewPool(read), t, locale)
		return {
			tone: status.tone,
			title: status.title,
			body: status.body,
			progress: status.progress,
			alarming: alarmingTone(status.tone),
			space: status.space,
			damaged: read.pool.dataErrors > 0,
		}
	}

	// A storage that was set up and isn't running
	if (raid.name || isPro) {
		return {
			tone: 'attention',
			title: t('storage-single.unreadable.unidentified.title'),
			body: t('storage-single.unreadable.unidentified.body'),
			alarming: true,
		}
	}

	// Everything is on the drive umbrelOS starts from, when umbreld can see it. How full it is
	// has its own card and its own warning.
	const boot = devices.find((device): device is StorageDevice & {id: string} => !!device.id && !!device.isSystemDrive)
	const status = getSingleStatus({host, drive: boot ? toDrive(boot) : undefined, t})
	return {tone: status.tone, title: status.title, body: status.body, alarming: alarmingTone(status.tone)}
}
