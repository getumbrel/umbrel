import {useMutation} from '@tanstack/react-query'
import {useEffect} from 'react'
import {useInterval, usePrevious} from 'react-use'
import {uniq} from 'remeda'
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
	const ctx = trpcReact.useContext()

	const mut = useMutation(
		async () => {
			for (const app of apps ?? []) {
				await trpcClient.apps.uninstall.mutate({appId: app.id})
			}
		},
		{
			onSuccess: () => {
				toast(t('apps.uninstalled-all.success'))
				ctx.invalidate()
			},
		},
	)

	return () => mut.mutate()
}

// TODO: rename to something that covers more than install
export function useAppInstall(id: string) {
	const ctx = trpcReact.useContext()
	const appStateQ = trpcReact.apps.state.useQuery({appId: id})

	const refreshAppStates = () => {
		// Invalidate this app's state
		ctx.apps.state.invalidate({appId: id})
		// Invalidate list of apps on desktop
		ctx.apps.list.invalidate()
		// Invalidate latest app opens
		ctx.user.get.invalidate()
	}

	const makeOptimisticOnMutate = (optimisticState: (typeof pollStates)[number], onMutate?: () => void) => () => {
		// Optimistic because actions do not return until complete
		// see: https://create.t3.gg/en/usage/trpc#optimistic-updates
		ctx.apps.state.cancel()
		ctx.apps.state.setData({appId: id}, {state: optimisticState, progress: 0})
		onMutate?.()
		// TODO: The interval below starts ticking now, so the app's state will be
		// first updated in 2000ms. Should we refactor the backend to set the state,
		// return early and run the action asynchronously to make sure instead?
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
		onMutate: makeOptimisticOnMutate('installing', () => {
			// When there are no apps yet, this component is not guaranteed to remain
			// referenced, so the interval below might not execute. At the expense of
			// redundancy, make sure that the refresh happens in any case.
			setTimeout(refreshAppStates, 2000)
		}),
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
	const install = async () => installMut.mutate({appId: id})
	const getAppsToUninstallFirst = async () => {
		const appsToUninstallFirst = await getRequiredBy(id)
		// We expect to have an array, even if it's empty
		if (!appsToUninstallFirst) throw new Error(t('apps.uninstall.failed-to-get-required-apps'))
		if (appsToUninstallFirst.length > 0) {
			// TODO: clean up logic around multiple registries so we don't need to use `uniq`?
			return uniq(appsToUninstallFirst.map((app) => app.id))
		}
		return []
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

async function getRequiredBy(targetAppId: string) {
	// "installed"  really means they're user apps, because they can be in other states
	const installedApps = await trpcClient.apps.list.query()

	const availableApps = await trpcClient.appStore.registry.query()
	// Flatted apps from all registries
	const availableAppsFlat = availableApps.flatMap((group) => group.apps)
	// Filter out non-installed apps
	const availableAppsFlatAndInstalled = availableAppsFlat.filter((app) =>
		installedApps.find((userApp) => userApp.id === app.id),
	)

	// Look in array to see if `targetAppId` is a dependency of any of the apps
	const requiredByApps = availableAppsFlatAndInstalled.filter((app) => app.dependencies?.includes(targetAppId))

	return requiredByApps
}
