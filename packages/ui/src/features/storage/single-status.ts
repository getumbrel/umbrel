// What a machine that keeps everything on one drive says about it: whether that drive is all
// right, and how full it is. Storage Manager leads with this on Umbrel Home, Raspberry Pi and
// other single-drive setups, and so does everything outside it that talks about the storage.

import type {TFunction} from 'i18next'

import type {StatusTone} from './art'
import {Drive, formatSize, troubleOf} from './model'
import {NEARLY_FULL} from './state'

// What umbrelOS is running on, as far as storage is concerned
export type SingleHost =
	| 'home'
	| 'pi'
	| 'container'
	// Any other machine: with drives of its own, it could have had storage with FailSafe
	| 'other'
	// The machine couldn't be identified
	| 'unknown'

export type SingleStatus = {
	tone: StatusTone
	title: string
	body: string
	// The one thing to do about it
	action?: 'backups' | 'drive' | 'usage'
	// It is about running out of space, not about the drive
	space?: boolean
}

// One sentence, and the one thing to do about it
export function getSingleStatus({
	host,
	drive,
	usage,
	canViewUsage,
	t,
}: {
	host: SingleHost
	// The drive umbrelOS runs from, when umbreld can see it
	drive?: Drive
	usage?: {total: number; used: number}
	canViewUsage?: boolean
	t: TFunction
}): SingleStatus {
	const trouble = drive ? troubleOf(drive) : null
	const full = usage && usage.total > 0 ? Math.min(1, usage.used / usage.total) : 0
	const isHome = host === 'home'
	const kind = drive?.kind ?? 'ssd'
	const withSupport = (body: string) => (isHome ? `${body} ${t('storage-single.trouble.support')}` : body)
	if (trouble === 'failing') {
		return {
			tone: 'attention',
			title: t(`storage-single.trouble.failing.${kind}`),
			body: withSupport(t('storage-single.trouble.failing.body')),
			action: 'backups',
		}
	}
	if (trouble === 'critical' || trouble === 'hot') {
		return {
			tone: trouble === 'critical' ? 'critical' : 'attention',
			title: t(`storage-single.trouble.${trouble}.${kind}`),
			body: t(`storage-mgr.status.trouble.${trouble}.body`),
			action: 'drive',
		}
	}
	if (trouble === 'worn') {
		return {
			tone: 'attention',
			title: t('storage-single.trouble.worn.ssd'),
			body: withSupport(t('storage-single.trouble.worn.body')),
			action: 'backups',
		}
	}
	if (full >= NEARLY_FULL) {
		return {
			tone: 'attention',
			title: t('storage-mgr.status.full.title'),
			body: t('storage-single.full.body'),
			action: canViewUsage ? 'usage' : undefined,
			space: true,
		}
	}
	const size = drive && drive.size > 0 ? formatSize(drive.size) : undefined
	return {
		tone: 'healthy',
		title: t('storage-ui.health.healthy'),
		body:
			host === 'container'
				? t('storage-single.sentence.container')
				: isHome
					? size
						? t('storage-single.sentence.home', {size})
						: t('storage-single.sentence.home.unseen')
					: drive && size
						? t(`storage-single.sentence.drive.${drive.kind}`, {size})
						: t('storage-single.sentence.unseen'),
	}
}
