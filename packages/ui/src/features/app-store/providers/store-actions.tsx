import {createContext, useContext, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {registryAppPath} from '@/constants/app-store'
import {beginAppAction, finishAppAction} from '@/hooks/app-action-guard'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useUpdateAppMutation} from '@/hooks/use-update-app'
import {getDependencyAlternatives} from '@/modules/app-store/dependency-alternatives'
import {InstallReviewDialog} from '@/modules/app-store/install-review-dialog'
import {OSUpdateRequiredDialog} from '@/modules/app-store/os-update-required'
import type {InstallDependency} from '@/modules/app-store/select-dependencies-dialog'
import {canPresentUpdateAction} from '@/modules/app-store/update-availability'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {AppState, RegistryApp, RouterOutput, trpcReact} from '@/trpc/trpc'
import {stripErrorCode} from '@/utils/backend-error'

type StoreActionsContextT = {
	installApp: InstallDependency
	updateApp: (app: RegistryApp) => void
	openApp: (appId: string) => void
	/** Undefined for members, who can't start apps */
	startApp: ((appId: string) => void) | undefined
	isAppIdAmbiguous: (appId: string) => boolean
	pendingStates: ReadonlyMap<string, AppState>
}

const StoreActionsContext = createContext<StoreActionsContextT | null>(null)

/** Null when no provider is mounted — callers fall back to passive labels */
export function useStoreActions() {
	return useContext(StoreActionsContext)
}

/**
 * One shared install/update/open flow for every app card in the subtree, so
 * hundreds of cards can offer working actions without each mounting its own
 * dialogs. Runs the same gates as the app page's install button: members are
 * pointed to the owner, incompatible apps explain the required OS update, and
 * required apps, folders, and hardware access are reviewed before installing.
 */
export function StoreActionsProvider({children}: {children: React.ReactNode}) {
	const {t} = useTranslation()
	const userQ = trpcReact.user.get.useQuery()
	const isMember = userQ.data?.role === 'member'
	const {apps, ambiguousAppIds} = useAllAvailableApps()
	const {userAppsKeyed} = useApps()
	const launchApp = useLaunchApp()
	const utils = trpcReact.useUtils()

	const [dialog, setDialog] = useState<
		| {kind: 'os-update'; app: RegistryApp}
		| {kind: 'install-review'; app: RegistryApp; review: RouterOutput['apps']['installReview']}
		| null
	>(null)
	const [pendingStates, setPendingStates] = useState<ReadonlyMap<string, AppState>>(new Map())
	const setPendingState = (appId: string, state?: AppState) => {
		setPendingStates((current) => {
			const next = new Map(current)
			if (state) next.set(appId, state)
			else next.delete(appId)
			return next
		})
	}

	const installMut = trpcReact.apps.install.useMutation({
		// Optimistic seeding: the mutation doesn't return until the install
		// completes, so make the transition visible immediately
		onMutate: ({appId}) => {
			setPendingState(appId, 'installing')
			utils.apps.state.cancel()
			utils.apps.state.setData({appId}, {state: 'installing', progress: 0})
			setTimeout(() => utils.apps.list.invalidate(), 2000)
		},
		onSettled: (_data, _error, {appId}) => {
			finishAppAction(appId)
			setPendingState(appId)
			utils.apps.state.invalidate({appId})
			utils.apps.list.invalidate()
			utils.user.get.invalidate()
		},
		onError: (error) => {
			toast.error(t('app.toast.install-failed'), {area: 'app-store', description: stripErrorCode(error.message)})
		},
	})

	// The same optimistic seeding and refresh as every other update surface
	const updateMut = useUpdateAppMutation()

	// Starting and restarting don't return until the app is up, so the card
	// shows the transition from the moment the mutation starts
	const seedLifecycleState = (appId: string, state: 'starting' | 'restarting') => {
		setPendingState(appId, state)
		utils.apps.state.cancel()
		utils.apps.state.setData({appId}, {state, progress: 0})
	}
	const settleLifecycle = (appId: string) => {
		finishAppAction(appId)
		setPendingState(appId)
		utils.apps.state.invalidate({appId})
		utils.apps.list.invalidate()
	}
	const startMut = trpcReact.apps.start.useMutation({
		onMutate: ({appId}) => seedLifecycleState(appId, 'starting'),
		onSettled: (_data, _error, {appId}) => settleLifecycle(appId),
		onError: (error) =>
			toast.error(t('app.toast.start-failed'), {area: 'app-store', description: stripErrorCode(error.message)}),
	})
	const restartMut = trpcReact.apps.restart.useMutation({
		onMutate: ({appId}) => seedLifecycleState(appId, 'restarting'),
		onSettled: (_data, _error, {appId}) => settleLifecycle(appId),
		onError: (error) =>
			toast.error(t('app.toast.restart-failed'), {area: 'app-store', description: stripErrorCode(error.message)}),
	})

	// What tapping a stopped app's home screen icon does: start it, or restart
	// one whose state is unknown
	const startApp = (appId: string) => {
		if (!beginAppAction(appId)) return
		if (userAppsKeyed?.[appId]?.state === 'unknown') restartMut.mutate({appId})
		else startMut.mutate({appId})
	}

	const installApp: InstallDependency = async (app, presentDialog) => {
		if (!userQ.data) return
		if (isMember) return void toast(t('app-store.ask-owner-to-install'), {area: 'app-store'})
		if (ambiguousAppIds?.has(app.id)) return void toast(t('app-store.app-id-conflict'), {area: 'app-store'})
		if (!app.compatible) {
			const showDialog = () => setDialog({kind: 'os-update', app})
			return presentDialog ? presentDialog(showDialog) : showDialog()
		}
		let review: RouterOutput['apps']['installReview']
		try {
			review = await utils.apps.installReview.fetch({appId: app.id})
		} catch {
			return void toast.error(t('install-review.load-error'), {area: 'app-store'})
		}
		if ((app.dependencies?.length ?? 0) > 0 || review.requiredFolders.length > 0 || review.gpuAccess) {
			const showDialog = () => setDialog({kind: 'install-review', app, review})
			return presentDialog ? presentDialog(showDialog) : showDialog()
		}
		if (beginAppAction(app.id)) installMut.mutate({appId: app.id})
	}

	const updateApp = (app: RegistryApp) => {
		if (isMember) return void toast(t('app-store.ask-owner-to-update'), {area: 'app-store'})
		if (ambiguousAppIds?.has(app.id)) return void toast(t('app-store.app-id-conflict'), {area: 'app-store'})
		const state = userAppsKeyed?.[app.id]?.state ?? 'not-installed'
		if (!canPresentUpdateAction(state)) return
		if (!app.compatible) return setDialog({kind: 'os-update', app})
		updateMut.mutate({appId: app.id})
	}

	const closeDialog = (open: boolean) => {
		if (!open) setDialog(null)
	}
	const installReviewed = (
		appId: string,
		options: {alternatives: Record<string, string>; folderAccess: Array<{id: string; sourcePath: string}>},
	) => {
		if (ambiguousAppIds?.has(appId)) return void toast(t('app-store.app-id-conflict'), {area: 'app-store'})
		if (beginAppAction(appId)) installMut.mutate({appId, ...options})
	}

	return (
		<StoreActionsContext
			value={{
				installApp,
				updateApp,
				openApp: launchApp,
				// Only once the account is known to be the owner's: members can't start apps
				startApp: userQ.data?.role === 'owner' ? startApp : undefined,
				isAppIdAmbiguous: (appId) => ambiguousAppIds?.has(appId) ?? false,
				pendingStates,
			}}
		>
			{children}
			{dialog?.kind === 'os-update' && <OSUpdateRequiredDialog app={dialog.app} open onOpenChange={closeDialog} />}
			{dialog?.kind === 'install-review' && (
				<InstallReviewDialog
					app={dialog.app}
					review={dialog.review}
					dependencies={getDependencyAlternatives(dialog.app.dependencies, apps ?? [], userAppsKeyed, ambiguousAppIds)}
					open
					onOpenChange={closeDialog}
					onInstall={(options) => installReviewed(dialog.app.id, options)}
					onInstallDependency={installApp}
					makeDependencyPath={registryAppPath}
				/>
			)}
		</StoreActionsContext>
	)
}
