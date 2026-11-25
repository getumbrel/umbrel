// The moments a storage task ends, said wherever the person is: what a storage check found,
// FailSafe finishing its switch, a rebuild bringing protection back. Worded as Storage Manager
// words them. umbreld keeps no record of when a task ended, so these only reach a browser that
// was open when it did.

import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

import {toStorageState} from '../from-umbreld'
import {damageNotice} from '../manager/status'
import {promiseSentence} from '../phrases'
import {viewPool} from '../state'
import type {RaidProgress} from './use-raid-progress'

export function useStorageToasts(progress: RaidProgress | null) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const utils = trpcReact.useUtils()
	const type = progress?.type
	const state = progress?.state
	const errors = progress?.errors

	// A storage check runs unseen, and its result is the only thing said about it
	useEffect(() => {
		if (type !== 'scrub' || state !== 'finished') return
		if ((errors ?? 0) > 0) {
			const damage = damageNotice(t, errors ?? 0)
			toast.error(damage.title, {
				id: 'raid-scrub-result',
				area: 'settings',
				description: damage.body,
				duration: Infinity,
				fullClick: true,
				action: {label: t('notifications.view'), onClick: () => navigate('/settings/storage')},
			})
			return
		}
		toast.success(t('storage-manager.scrub.completed-toast'), {id: 'raid-scrub-result', area: 'settings'})
	}, [navigate, state, type, errors, t])

	// A day-long rebuild or switch to FailSafe ending is worth a moment. Only said when the
	// storage really is protected afterwards: with another drive still down, Storage Manager
	// has something else to say.
	useEffect(() => {
		const failsafe = type === 'failsafe-transition' && state === 'complete'
		const rebuilt = (type === 'replace' || type === 'rebuild') && state === 'finished'
		if (!failsafe && !rebuilt) return
		let stale = false
		void Promise.all([
			utils.hardware.raid.getStatus.fetch(undefined, {staleTime: 0}),
			utils.hardware.internalStorage.getDevices.fetch(),
			utils.hardware.umbrelPro.isUmbrelPro.fetch(),
		])
			.then(([raid, devices, isPro]) => {
				if (stale) return
				const storage = toStorageState({raid, devices, isPro, progress: null, record: null})
				const {layout, kind, accel} = storage?.pool ?? {}
				if (!storage || !layout || layout === 'stripe' || !kind || viewPool(storage).status !== 'protected') return
				toast.success(t(failsafe ? 'storage-mgr.status.done.failsafe' : 'storage-mgr.status.done.rebuild'), {
					id: 'raid-task-done',
					area: 'settings',
					description: promiseSentence(t, layout, kind, accel?.length ?? 0),
				})
			})
			// Nothing is lost by not saying it: Storage Manager shows where things stand
			.catch(() => undefined)
		return () => {
			stale = true
		}
	}, [state, type, t, utils])
}
