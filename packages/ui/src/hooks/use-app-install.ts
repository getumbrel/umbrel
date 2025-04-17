import {useMutation} from '@tanstack/react-query'
import {useEffect} from 'react'
import {useInterval, usePrevious} from 'react-use'
import {toast} from 'sonner'
import {arrayIncludes} from 'ts-extras'

import {AppState, AppStateOrLoading, trpcClient, trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

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

export function useUninstallAllApps() {
	const apps = trpcReact.apps.list.useQuery().data
	const utils = trpcReact.useUtils()

	const mut = useMutation({
		mutationFn: async () => {
			for (const app of apps ?? []) {
				await trpcClient.apps.uninstall.mutate({appId: app.id})
			}
		},

		onSuccess: () => {
			toast(t('apps.uninstalled-all.success'))
			utils.invalidate()
		},
	})

	return () => mut.mutate()
}

// TODO: rename to something that covers more than install
export function useAppInstall(id: string) {
	const utils = trpcReact.useUtils()
	const appStateQ = trpcReact.apps.state.useQuery({appId: id})

	const refreshAppStates = () => {
		// Invalidate this app's state
		utils.apps.state.invalidate({appId: id})
		// Invalidate list of apps on desktop
		utils.apps.list.invalidate()
		// Invalidate latest app opens
		utils.user.get.invalidate()
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
		onSettled: refreshAppStates,
	})
	const stopMut = trpcReact.apps.stop.useMutation({
		onMutate: makeOptimisticOnMutate('stopping'),
		onSettled: refreshAppStates,
	})
	const installMut = trpcReact.apps.install.useMutation({
		onMutate: makeOptimisticOnMutate('installing'),
		onSettled: refreshAppStates,
	})
	const uninstallMut = trpcReact.apps.uninstall.useMutation({
		onMutate: makeOptimisticOnMutate('uninstalling'),
		onSettled: refreshAppStates,
	})
	const restartMut = trpcReact.apps.restart.useMutation({
		onMutate: makeOptimisticOnMutate('restarting'),
		onSettled: refreshAppStates,
	})

	const appState = appStateQ.data?.state
	const progress = appStateQ.data?.progress

	// Poll for install status if we're installing or uninstalling
	const shouldPollForStatus = appState && arrayIncludes(pollStates, appState)
	useInterval(appStateQ.refetch, shouldPollForStatus ? 2000 : null)

	// Also refresh app states when polling ends in case this tab isn't the one
	// owning the mutation and hence isn't notified when it settles
	const prevShouldPollForStatus = usePrevious(shouldPollForStatus)
	useEffect(() => {
		if (!shouldPollForStatus && prevShouldPollForStatus === true) {
			refreshAppStates()
		}
	}, [shouldPollForStatus, prevShouldPollForStatus])

	const start = async () => startMut.mutate({appId: id})
	const stop = async () => stopMut.mutate({appId: id})
	const install = async (alternatives?: Record<string, string>) => {
		return installMut.mutate({appId: id, alternatives})
	}
	const getAppsToUninstallFirst = async () => {
		const appsToUninstallFirst = await trpcClient.apps.dependents.query(id)
		// We expect to have an array, even if it's empty
		if (!appsToUninstallFirst) throw new Error(t('apps.uninstall.failed-to-get-required-apps'))
		return appsToUninstallFirst
	}
	const uninstall = async () => {
		const uninstallTheseFirst = await getAppsToUninstallFirst()
		if (uninstallTheseFirst.length > 0) {
			return {uninstallTheseFirst}
		}
		uninstallMut.mutate({appId: id})
	}
	const restart = async () => restartMut.mutate({appId: id})

	// Ready means the app can be installed
	const state: AppStateOrLoading = appStateQ.isLoading ? 'loading' : (appState ?? 'not-installed')

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
