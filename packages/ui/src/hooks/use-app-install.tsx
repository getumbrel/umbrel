import {useCallback, useEffect, useRef} from 'react'
import {arrayIncludes} from 'ts-extras'

import {AppState, trpcReact} from '@/trpc/trpc'
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
	const uninstall = async () => uninstallMut.mutate({appId: id})
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
