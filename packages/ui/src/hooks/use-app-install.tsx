import {useCallback, useEffect, useRef} from 'react'
import {arrayIncludes} from 'ts-extras'

import {AppState, trpcClient, trpcReact} from '@/trpc/trpc'
import {progressStates} from '@/utils/misc'

export type InstallState = 'loading' | 'uninstalled' | AppState

export function useAppInstall(id: string) {
	const ctx = trpcReact.useContext()
	const invalidateInstallDependencies = useCallback(() => {
		ctx.user.apps.getInstallStatus.invalidate({appId: id})
		// Invalidate desktop
		ctx.user.apps.getAll.invalidate()
		// Invalidate latest app opens
		ctx.user.get.invalidate()
	}, [ctx.user.apps.getAll, ctx.user.apps.getInstallStatus, ctx.user.get, id])

	const installStatusQ = trpcReact.user.apps.getInstallStatus.useQuery({appId: id})

	// Refetch so that we can update the `appState` variable, which then triggers the useEffect below
	const installMut = trpcReact.user.apps.install.useMutation({onSuccess: invalidateInstallDependencies})
	const uninstallMut = trpcReact.user.apps.uninstall.useMutation({onSuccess: invalidateInstallDependencies})
	const uninstallAllMut = trpcReact.user.apps.uninstallAll.useMutation({onSuccess: invalidateInstallDependencies})
	const restartMut = trpcReact.user.apps.restart.useMutation({onSuccess: invalidateInstallDependencies})

	const appState = installStatusQ.data?.state
	const progress = installStatusQ.data?.installProgress

	// Poll for install status if we're installing or uninstalling
	const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
	useEffect(() => {
		if (!appState) return
		if (!arrayIncludes(progressStates, appState)) {
			clearInterval(intervalRef.current)
			invalidateInstallDependencies()
			return
		}
		intervalRef.current = setInterval(installStatusQ.refetch, 500)
		return () => clearInterval(intervalRef.current)
	}, [appState, installStatusQ, invalidateInstallDependencies])

	const install = async () => installMut.mutate({appId: id})
	const uninstall = async () => {
		const appsToUninstallFirst = await getRequiredBy(id)
		// We expect to have an array, even if it's empty
		if (!appsToUninstallFirst) throw new Error('Failed to get required apps')
		if (appsToUninstallFirst.length > 0) {
			return {uninstallTheseFirst: appsToUninstallFirst.map((app) => app.id)}
		}
		uninstallMut.mutate({appId: id})
	}
	const uninstallAll = async () => uninstallAllMut.mutate()
	const restart = async () => restartMut.mutate({appId: id})

	// Ready means the app can be installed
	const state: InstallState = installStatusQ.isLoading ? 'loading' : appState ?? 'uninstalled'

	return {
		restart,
		install,
		uninstall,
		uninstallAll,
		progress,
		state,
	}
}

async function getRequiredBy(targetAppId: string) {
	const userApps = await trpcClient.user.apps.getAll.query()
	const availableApps = await trpcClient.appStore.registry.query()

	type Group = NonNullable<(typeof availableApps)[0]>

	const nonNullGroups = availableApps.filter((group): group is Group => group !== null)

	// We don't need to check if apps are installed because if it's in the user apps, then it means we're busy with the apps, so not safe to uninstall until it's no longer in the user apps entirely
	return userApps.filter((userApp) => {
		const registryApps = nonNullGroups.find((group) => group.meta.id === userApp.registryId)?.apps
		if (!registryApps) return false

		const deps = registryApps.find((app) => app.id === userApp.id)?.dependencies

		return deps?.includes(targetAppId)
	})
}
