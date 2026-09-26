import prettyBytes from 'pretty-bytes'
import {createContext, useContext, useImperativeHandle, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {toast} from '@/components/ui/toast'
import {registryAppPath} from '@/constants/app-store'
import {useStoreActions} from '@/features/app-store/providers/store-actions'
import {useAppInstall} from '@/hooks/use-app-install'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useUpdateApp} from '@/hooks/use-update-app'
import {getDependencyAlternatives} from '@/modules/app-store/dependency-alternatives'
import {InstallReviewDialog} from '@/modules/app-store/install-review-dialog'
import {OSUpdateRequiredDialog} from '@/modules/app-store/os-update-required'
import {canPresentUpdateAction, isAppUpdateAvailable} from '@/modules/app-store/update-availability'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {RegistryApp, trpcReact} from '@/trpc/trpc'

import {InstallButton} from './install-button'

export type InstallButtonConnectedHandle = {
	triggerInstall: (highlightDependency?: string) => void
}

type LoadingController = {
	status: 'loading'
	app: RegistryApp
	installSize: string | undefined
	progress: number | undefined
}

type ReadyController = {
	status: 'ready'
	app: RegistryApp
	installSize: string | undefined
	progress: number | undefined
	installState: ReturnType<typeof useAppInstall>['state']
	install: () => void
	open: () => void
	update: () => void
	updatePending: boolean
	canOfferUpdate: boolean
	isAppIdAmbiguous: boolean
}

type InstallController = LoadingController | ReadyController
const InstallButtonControllerContext = createContext<InstallController | null>(null)

/**
 * Owns install/update/dependency state once while allowing the expanded hero
 * and compact toolbar to render native-sized action controls from that same
 * controller. Dialogs also live here, so duplicated visual triggers never
 * create independent flows.
 */
export function InstallButtonConnectedController({
	app,
	children,
	ref,
}: {
	app: RegistryApp
	children: React.ReactNode
	ref?: React.Ref<InstallButtonConnectedHandle>
}) {
	const {t} = useTranslation()
	const appInstall = useAppInstall(app.id)
	// Members browse the app store read-only, only the owner can install
	const userQ = trpcReact.user.get.useQuery()
	const isMember = userQ.data?.role === 'member'
	const {apps, ambiguousAppIds, resolvedAppsKeyed} = useAllAvailableApps()
	const actions = useStoreActions()
	const installReviewQ = trpcReact.apps.installReview.useQuery(
		{appId: app.id},
		{enabled: userQ.data?.role === 'owner' && app.compatible && appInstall.state === 'not-installed'},
	)
	const [showInstallReview, setShowInstallReview] = useState(false)
	const [showOSUpdateRequiredDialog, setShowOSUpdateRequiredDialog] = useState(false)
	const {userAppsKeyed, isLoading} = useApps()
	const openApp = useLaunchApp()
	const updateApp = useUpdateApp(app.id)
	const [highlightDependency, setHighlightDependency] = useState<string | undefined>(undefined)

	const ready = !isLoading && Boolean(userQ.data && userAppsKeyed && apps && ambiguousAppIds && resolvedAppsKeyed)
	const isAppIdAmbiguous = Boolean(ambiguousAppIds?.has(app.id))
	const dependencies =
		ready && apps && userAppsKeyed && ambiguousAppIds
			? getDependencyAlternatives(app.dependencies, apps, userAppsKeyed, ambiguousAppIds)
			: []

	async function install() {
		if (!ready) return
		if (isMember) {
			toast(t('app-store.ask-owner-to-install'), {area: 'app-store'})
			return
		}
		if (isAppIdAmbiguous) {
			toast(t('app-store.app-id-conflict'), {area: 'app-store'})
			return
		}
		if (!app.compatible) {
			setShowOSUpdateRequiredDialog(true)
			return
		}
		const review = installReviewQ.data ?? (await installReviewQ.refetch()).data
		if (!review) {
			toast.error(t('install-review.load-error'), {area: 'app-store'})
			return
		}
		if (dependencies.length > 0 || review.requiredFolders.length > 0 || review.gpuAccess) {
			setShowInstallReview(true)
			return
		}
		appInstall.install()
	}

	useImperativeHandle(ref, () => ({
		triggerInstall(highlightDependency?: string) {
			setHighlightDependency(highlightDependency)
			void install()
		},
	}))

	// Open remains the primary installed-app action. Updates are offered
	// separately so an incompatible update never blocks launching the app.
	const userApp = userAppsKeyed?.[app.id]
	const resolvedApp = resolvedAppsKeyed?.[app.id] ?? app
	const updateAvailable = !isMember && !!userApp && isAppUpdateAvailable(userApp.version, resolvedApp)
	const canOfferUpdate = ready && updateAvailable && canPresentUpdateAction(appInstall.state)
	const update = () => {
		if (!canPresentUpdateAction(appInstall.state)) return
		if (!resolvedApp.compatible) {
			setShowOSUpdateRequiredDialog(true)
			return
		}
		updateApp.update()
	}

	const installSize = app.installSize ? prettyBytes(app.installSize) : undefined
	const controller: InstallController = ready
		? {
				status: 'ready',
				app,
				installSize,
				progress: appInstall.progress,
				installState: appInstall.state,
				install,
				open: () => openApp(app.id),
				update,
				updatePending: updateApp.isPending,
				canOfferUpdate,
				isAppIdAmbiguous,
			}
		: {status: 'loading', app, installSize, progress: appInstall.progress}

	return (
		<InstallButtonControllerContext value={controller}>
			{children}
			{ready && (
				<>
					{installReviewQ.data && (
						<InstallReviewDialog
							app={app}
							review={installReviewQ.data}
							dependencies={dependencies}
							open={showInstallReview}
							onOpenChange={setShowInstallReview}
							onInstall={appInstall.install}
							highlightDependency={highlightDependency}
							onInstallDependency={actions?.installApp}
							makeDependencyPath={registryAppPath}
						/>
					)}
					<OSUpdateRequiredDialog
						app={app}
						open={showOSUpdateRequiredDialog}
						onOpenChange={setShowOSUpdateRequiredDialog}
					/>
				</>
			)}
		</InstallButtonControllerContext>
	)
}

export function InstallButtonConnectedView() {
	const {t} = useTranslation()
	const controller = useContext(InstallButtonControllerContext)
	if (!controller) throw new Error('InstallButtonConnectedView must be used within InstallButtonConnectedController')

	if (controller.status === 'loading') {
		return (
			<InstallButton
				key={controller.app.id}
				installSize={controller.installSize}
				progress={controller.progress}
				state='loading'
			/>
		)
	}

	return (
		<div className='flex flex-col gap-1.5'>
			<div className='flex items-center gap-3 max-sm:flex-col max-sm:items-stretch md:gap-4'>
				<InstallButton
					key={controller.app.id}
					installSize={controller.installSize}
					progress={controller.progress}
					state={controller.installState}
					onInstallClick={controller.install}
					onOpenClick={controller.open}
					disabled={controller.isAppIdAmbiguous && controller.installState === 'not-installed'}
				/>
				{controller.canOfferUpdate && (
					<Button
						size='lg'
						onClick={controller.update}
						disabled={controller.updatePending}
						className='max-sm:h-[30px] max-sm:w-full max-sm:text-13'
					>
						{t('app-updates.update')}
					</Button>
				)}
			</div>
			{controller.isAppIdAmbiguous && (
				<p className='max-w-64 text-right text-11 leading-tight text-amber-200/70 max-sm:text-center'>
					{t('app-store.app-id-conflict')}
				</p>
			)}
		</div>
	)
}

export function InstallButtonConnected({app, ref}: {app: RegistryApp; ref?: React.Ref<InstallButtonConnectedHandle>}) {
	return (
		<InstallButtonConnectedController app={app} ref={ref}>
			<InstallButtonConnectedView />
		</InstallButtonConnectedController>
	)
}
