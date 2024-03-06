import {useMutation} from '@tanstack/react-query'
import {useCallback, useEffect} from 'react'
import {useInterval} from 'react-use'
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

export function useInvalidateDeps(appId: string) {
	const ctx = trpcReact.useContext()

	return useCallback(() => {
		ctx.apps.state.invalidate({appId})
		// Invalidate desktop
		ctx.apps.list.invalidate()
		// Invalidate latest app opens
		ctx.user.get.invalidate()
	}, [appId, ctx.apps.state, ctx.apps.list, ctx.user.get])
}

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

export function useAppInstall(id: string) {
	const invalidateInstallDependencies = useInvalidateDeps(id)

	const ctx = trpcReact.useContext()
	const appStateQ = trpcReact.apps.state.useQuery({appId: id})

	// Refetch so that we can update the `appState` variable, which then triggers the useEffect below
	// Also doing optimistic updates here:
	// https://create.t3.gg/en/usage/trpc#optimistic-updates
	// Optimistic because `trpcReact.apps.install` doesn't return until the app is installed
	const installMut = trpcReact.apps.install.useMutation({
		onSuccess: invalidateInstallDependencies,
		onMutate() {
			ctx.apps.state.cancel()
			ctx.apps.state.setData({appId: id}, {state: 'installing', progress: 0})
		},
	})
	const uninstallMut = trpcReact.apps.uninstall.useMutation({onSuccess: invalidateInstallDependencies})
	const restartMut = trpcReact.apps.restart.useMutation({onSuccess: invalidateInstallDependencies})

	const appState = appStateQ.data?.state
	const progress = appStateQ.data?.progress

	// Poll for install status if we're installing or uninstalling
	const shouldPollForStatus = appState && arrayIncludes(pollStates, appState)
	useInterval(appStateQ.refetch, shouldPollForStatus ? 500 : null)
	useEffect(() => {
		if (appState && !arrayIncludes(pollStates, appState)) {
			invalidateInstallDependencies()
		}
	}, [appState, appStateQ, invalidateInstallDependencies])

	const install = async () => installMut.mutate({appId: id})
	const getAppsToUninstallFirst = async () => {
		const appsToUninstallFirst = await getRequiredBy(id)
		// We expect to have an array, even if it's empty
		if (!appsToUninstallFirst) throw new Error(t('apps.uninstall.failed-to-get-required-apps'))
		if (appsToUninstallFirst.length > 0) {
			return appsToUninstallFirst.map((app) => app.id)
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
	const state: AppStateOrLoading = appStateQ.isLoading ? 'loading' : appState ?? 'not-installed'

	return {
		restart,
		install,
		getAppsToUninstallFirst,
		uninstall,
		progress,
		state,
	} as const
}

async function getRequiredBy(targetAppId: string) {
	const apps = await trpcClient.apps.list.query()
	const availableApps = await trpcClient.appStore.registry.query()

	type Group = NonNullable<(typeof availableApps)[0]>

	const nonNullGroups = availableApps.filter((group): group is Group => group !== null)

	// We don't need to check if apps are installed because if it's in the user apps, then it means we're busy with the apps, so not safe to uninstall until it's no longer in the user apps entirely
	return apps.filter((userApp) => {
		// @ts-expect-error `registryId`
		const registryApps = nonNullGroups.find((group) => group.meta.id === userApp.registryId)?.apps
		if (!registryApps) return false

		const deps = registryApps.find((app) => app.id === userApp.id)?.dependencies

		return deps?.includes(targetAppId)
	})
}
