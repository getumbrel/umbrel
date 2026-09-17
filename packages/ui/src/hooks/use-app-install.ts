import {useMutation} from '@tanstack/react-query'
import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'
import {usePrevious} from 'react-use'
import {arrayIncludes} from 'ts-extras'

import {toast} from '@/components/ui/toast'
import {AppState, AppStateOrLoading, trpcReact} from '@/trpc/trpc'
import {stripErrorCode} from '@/utils/backend-error'

import {beginAppAction, finishAppAction} from './app-action-guard'
import {usePendingAppUpdateIds} from './use-update-app'

// TODO: consider adding `stopped` and `unknown`
/** States where we want to frequently poll (on the order of seconds) */
export const pollStates = [
	'installing',
	'uninstalling',
	'updating',
	'starting',
	'restarting',
	'stopping',
] as const satisfies readonly AppState[]

// Which actions make sense for an app in a given state, shared by the desktop
// icon context menu and the live-usage row menu
export const canStart = (state: AppStateOrLoading) => arrayIncludes(['stopped', 'unknown'], state)
export const canStop = (state: AppStateOrLoading) => arrayIncludes(['running', 'ready'], state)
export const canRestart = (state: AppStateOrLoading) => arrayIncludes(['running', 'ready', 'unknown'], state)

/**
 * Light per-app state that adds zero requests no matter how many icons or rows
 * mount it: reads the already-cached apps list, plus a fetch-less peek at the
 * per-app state cache so optimistic transition states seeded by useAppInstall
 * mutations show instantly everywhere. Freshness comes from the usual
 * invalidations; the transition polling itself lives in useAppInstall.
 */
export function useAppState(appId: string): AppStateOrLoading {
	const pendingUpdateIds = usePendingAppUpdateIds()
	const listQ = trpcReact.apps.list.useQuery(undefined, {
		select: (apps): AppState | 'not-installed' => {
			const app = apps.find((app) => app.id === appId)
			if (!app) return 'not-installed'
			// Apps the backend failed to load report an error instead of a state
			return 'state' in app ? app.state : 'unknown'
		},
	})
	const perAppQ = trpcReact.apps.state.useQuery({appId}, {enabled: false})
	// Update requests stay pending until completion. An early poll can still
	// report ready while the server prepares the update, so keep the optimistic
	// state visible until this app's mutation settles.
	if (pendingUpdateIds.includes(appId)) return 'updating'
	// The per-app cache wins whenever it's fresher than the list: optimistic
	// seeds (setData bumps dataUpdatedAt) show instantly, and a poll's terminal
	// state ends a transition the moment it lands rather than waiting on the
	// list refresh that very flip is what triggers — deferring to a stale list
	// here would deadlock a transition observed from a non-mutating tab in
	// permanent "installing" (and flicker through stale states in the owner tab)
	if (perAppQ.data && perAppQ.dataUpdatedAt > listQ.dataUpdatedAt) return perAppQ.data.state
	return listQ.isLoading ? 'loading' : (listQ.data ?? 'not-installed')
}

/**
 * State plus live install/update progress for one app, cheap enough to mount
 * on every card in a grid: no mutations, zero requests while idle, and during
 * a transition all observers share the single 2s poll of the per-app state
 * endpoint (refetchInterval is per query key, not per observer).
 */
export function useAppInstallProgress(appId: string): {state: AppStateOrLoading; progress?: number} {
	const utils = trpcReact.useUtils()
	const state = useAppState(appId)
	const isTransitioning = state !== 'loading' && arrayIncludes(pollStates, state)
	const appStateQ = trpcReact.apps.state.useQuery(
		{appId},
		{enabled: isTransitioning, refetchInterval: isTransitioning ? 2000 : false},
	)

	// When a transition observed from here ends (e.g. another tab ran the
	// mutation), refresh the list so derived statuses catch up
	const prevIsTransitioning = usePrevious(isTransitioning)
	useEffect(() => {
		if (!isTransitioning && prevIsTransitioning === true) {
			utils.apps.state.invalidate({appId})
			utils.apps.list.invalidate()
		}
	}, [isTransitioning, prevIsTransitioning, utils, appId])

	return {state, progress: isTransitioning ? appStateQ.data?.progress : undefined}
}

export function useUninstallAllApps() {
	const {t} = useTranslation()
	const apps = trpcReact.apps.list.useQuery().data
	const utils = trpcReact.useUtils()
	const uninstallMut = trpcReact.apps.uninstall.useMutation()

	const mut = useMutation({
		mutationFn: async () => {
			for (const app of apps ?? []) {
				await uninstallMut.mutateAsync({appId: app.id})
			}
		},

		onSuccess: () => {
			toast(t('apps.uninstalled-all.success'), {area: 'app-store'})
			utils.invalidate()
		},
	})

	return () => mut.mutate()
}

// TODO: rename to something that covers more than install
export function useAppInstall(id: string) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const state = useAppState(id)
	const isTransitioning = state !== 'loading' && arrayIncludes(pollStates, state)

	// The per-app state endpoint only matters while the app is transitioning: it
	// carries progress and needs seconds-fresh data. The query is enabled (and
	// polled) only then; refetchInterval is shared across all observers of the
	// key, so any number of mounted icons/rows produce a single 2s poll.
	const appStateQ = trpcReact.apps.state.useQuery(
		{appId: id},
		{enabled: isTransitioning, refetchInterval: isTransitioning ? 2000 : false},
	)

	const refreshAppStates = () => {
		// Invalidate this app's state
		utils.apps.state.invalidate({appId: id})
		// Invalidate list of apps on desktop
		utils.apps.list.invalidate()
		// Invalidate latest app opens
		utils.user.get.invalidate()
	}
	const settleAppAction = () => {
		finishAppAction(id)
		refreshAppStates()
	}

	const makeOptimisticOnMutate = (optimisticState: (typeof pollStates)[number]) => () => {
		// Optimistic because actions do not return until complete
		// see: https://create.t3.gg/en/usage/trpc#optimistic-updates
		utils.apps.state.cancel()
		utils.apps.state.setData({appId: id}, {state: optimisticState, progress: 0})

		// Make sure apps list reflects the change in time. This is necessary
		// because a request to, say, install an app does not return until the
		// action is complete. TODO: Refactor the backend to set the state, return
		// early and run the actual action asynchronously.
		setTimeout(() => utils.apps.list.invalidate(), 2000)
	}

	const startMut = trpcReact.apps.start.useMutation({
		onMutate: makeOptimisticOnMutate('starting'),
		onError: (error) =>
			toast.error(t('app.toast.start-failed'), {area: 'app-store', description: stripErrorCode(error.message)}),
		onSettled: settleAppAction,
	})
	const stopMut = trpcReact.apps.stop.useMutation({
		onMutate: makeOptimisticOnMutate('stopping'),
		onError: (error) =>
			toast.error(t('app.toast.stop-failed'), {area: 'app-store', description: stripErrorCode(error.message)}),
		onSettled: settleAppAction,
	})
	const installMut = trpcReact.apps.install.useMutation({
		onMutate: makeOptimisticOnMutate('installing'),
		onError: (error) =>
			toast.error(t('app.toast.install-failed'), {area: 'app-store', description: stripErrorCode(error.message)}),
		onSettled: settleAppAction,
	})
	const uninstallMut = trpcReact.apps.uninstall.useMutation({
		onMutate: makeOptimisticOnMutate('uninstalling'),
		onSettled: settleAppAction,
	})
	const restartMut = trpcReact.apps.restart.useMutation({
		onMutate: makeOptimisticOnMutate('restarting'),
		onError: (error) =>
			toast.error(t('app.toast.restart-failed'), {area: 'app-store', description: stripErrorCode(error.message)}),
		onSettled: settleAppAction,
	})

	const progress = appStateQ.data?.progress

	// Also refresh app states when polling ends in case this tab isn't the one
	// owning the mutation and hence isn't notified when it settles
	const prevIsTransitioning = usePrevious(isTransitioning)
	useEffect(() => {
		if (!isTransitioning && prevIsTransitioning === true) {
			refreshAppStates()
		}
	}, [isTransitioning, prevIsTransitioning])

	const start = () => {
		if (beginAppAction(id)) startMut.mutate({appId: id})
	}
	const stop = () => {
		if (beginAppAction(id)) stopMut.mutate({appId: id})
	}
	const install = ({
		alternatives,
		folderAccess,
	}: {
		alternatives?: Record<string, string>
		folderAccess?: Array<{id: string; sourcePath: string}>
	} = {}) => {
		if (beginAppAction(id)) installMut.mutate({appId: id, alternatives, folderAccess})
	}
	const getAppsToUninstallFirst = async () => {
		// Dependency membership can change moments before this prompt (for example,
		// after uninstalling a dependent), so this safety check must never use the
		// UI's normal one-minute query cache.
		const appsToUninstallFirst = await utils.apps.dependents.fetch(id, {staleTime: 0})
		// We expect to have an array, even if it's empty
		if (!appsToUninstallFirst) throw new Error(t('apps.uninstall.failed-to-get-required-apps'))
		return appsToUninstallFirst
	}
	const uninstall = async () => {
		if (!beginAppAction(id)) return
		try {
			const uninstallTheseFirst = await getAppsToUninstallFirst()
			if (uninstallTheseFirst.length > 0) {
				finishAppAction(id)
				return {uninstallTheseFirst}
			}
			uninstallMut.mutate({appId: id})
		} catch (error) {
			finishAppAction(id)
			throw error
		}
	}
	const restart = () => {
		if (beginAppAction(id)) restartMut.mutate({appId: id})
	}

	return {
		start,
		stop,
		restart,
		install,
		getAppsToUninstallFirst,
		uninstall,
		progress,
		state,
	} as const
}
