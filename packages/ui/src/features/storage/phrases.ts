// The wording the storage screens share. Sentences are whole and counts are numerals, so
// every one of them can be translated as it stands. A machine with only SSDs is told about
// SSDs, never "drives".

import type {TFunction} from 'i18next'

import {Drive, DriveKind, FailsafeLayout, formatSize, LayoutProblem, Trouble} from './model'
import {Blocked, Need, Operation} from './state'

// How many acceleration SSDs change what a level promises: with two, one of them can fail too
const scope = (kind: DriveKind, accel: number) => (kind === 'ssd' ? 'ssd' : accel > 0 ? 'hdd-accel' : 'hdd')

// "Any one SSD can fail"
export const promise = (t: TFunction, layout: FailsafeLayout, kind: DriveKind, accel = 0) =>
	t(`storage-ui.promise.${layout}.${scope(kind, accel)}`)

// "Any one SSD can fail and your data stays safe."
export const promiseSentence = (t: TFunction, layout: FailsafeLayout, kind: DriveKind, accel = 0) =>
	t(`storage-ui.promise-sentence.${layout}.${scope(kind, accel)}`)

// "4TB SSD", "8TB hard drive". Just "SSD" or "Hard drive" when the size isn't known.
export const driveOfSize = (t: TFunction, drive: Pick<Drive, 'kind' | 'size'>) =>
	drive.size > 0
		? t(drive.kind === 'ssd' ? 'storage-ui.ssd-of-size' : 'storage-ui.hard-drive-of-size', {
				size: formatSize(drive.size),
			})
		: t(drive.kind === 'ssd' ? 'storage-ui.ssd' : 'storage-ui.hard-drive')

// What tells one drive from another of the same size: its model and serial number, as far as
// they are known
export const identityOf = (drive: Pick<Drive, 'model' | 'serial'>) =>
	[drive.model, drive.serial].filter(Boolean).join(' - ')

// What a drive is called at the head of its sheet: its slot on Umbrel Pro, its size anywhere else
export const driveTitle = (t: TFunction, drive: Drive) => (drive.slot ? `SSD ${drive.slot}` : driveOfSize(t, drive))

export const troubleNote = (t: TFunction, trouble: Trouble) => t(`storage-ui.trouble.${trouble}`)

export const problemLabel = (t: TFunction, problem: LayoutProblem) => t(`storage-ui.problem.${problem}`)

// "2 hard drives of 8TB or larger and 1 hard drive of 4TB or larger"
export function listNeeds(t: TFunction, needs: Need[], locale: string): string {
	const groups = new Map<string, {kind: DriveKind; size: number; count: number}>()
	for (const need of needs) {
		const key = `${need.kind}-${need.size}`
		const group = groups.get(key) ?? {kind: need.kind, size: need.size, count: 0}
		group.count += 1
		groups.set(key, group)
	}
	const parts = [...groups.values()]
		.sort((a, b) => b.size - a.size)
		.map((group) => t(`storage-ui.need.${group.kind}`, {count: group.count, size: formatSize(group.size)}))
	return new Intl.ListFormat(locale, {style: 'long', type: 'conjunction'}).format(parts)
}

// "A storage check is running, 12%."
export const taskSentence = (t: TFunction, task: Operation['kind'], progress: number) =>
	t(`storage-ui.task.${task}`, {progress})

// Why something can't be done, as one sentence a person can act on
export function blockedSentence(t: TFunction, blocked: Blocked, kind: DriveKind, locale: string): string {
	switch (blocked.why) {
		case 'busy':
			return t('storage-ui.blocked.busy', {task: taskSentence(t, blocked.task, blocked.progress)})
		case 'wrong-kind':
			return t(`storage-ui.blocked.wrong-kind.${blocked.poolKind}`)
		case 'too-small':
			return t(`storage-ui.blocked.too-small.${kind}`, {size: formatSize(blocked.size)})
		case 'limit':
			return t('storage-ui.blocked.limit')
		case 'needs-pair':
			return t('storage-ui.blocked.needs-pair')
		case 'accel-on':
			return t('storage-ui.blocked.accel-on')
		case 'accel-for-failsafe':
			return t('storage-ui.blocked.accel-for-failsafe')
		case 'accel-needs-two':
			return t('storage-ui.blocked.accel-needs-two')
		case 'repair-first':
			return t('storage-ui.blocked.repair-first')
		case 'partly-on':
			return t('storage-ui.blocked.partly-on')
		case 'failing':
			return t(`storage-ui.blocked.failing.${kind}`)
		case 'needs-drives': {
			const needs = [
				...blocked.missing,
				...(blocked.ssd !== undefined ? [{kind: 'ssd' as const, size: blocked.ssd}] : []),
			]
			return t('storage-ui.blocked.needs-drives', {list: listNeeds(t, needs, locale)})
		}
	}
}
