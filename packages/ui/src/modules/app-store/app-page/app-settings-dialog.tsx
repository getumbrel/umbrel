import {AnimatePresence, motion} from 'motion/react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {useTranslation} from 'react-i18next'
import {
	TbAdjustmentsHorizontal,
	TbAlertTriangle,
	TbDatabase,
	TbInfoCircle,
	TbKey,
	TbLock,
	TbPlugConnected,
} from 'react-icons/tb'
import {useLocation, useNavigate} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {ImmersiveDialog, ImmersiveDialogSplitContent} from '@/components/ui/immersive-dialog'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {registryAppPath} from '@/constants/app-store'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {appStateToString} from '@/modules/app-store/app-state-strings'
import {isAppUpdateAvailable} from '@/modules/app-store/update-availability'
import {useApps, useUserApp} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {installedStates, progressStates, RegistryApp, trpcReact, UserApp} from '@/trpc/trpc'
import {getErrorCode, stripErrorCode} from '@/utils/backend-error'
import {getDialogParamKey, useDialogOpenProps} from '@/utils/dialog'

import {getDependencyAlternatives} from '../dependency-alternatives'
import {SelectDependencies, type InstallDependency} from '../select-dependencies-dialog'
import {AdvancedSettingsView, EnvironmentSettingsView} from './app-settings-advanced'
import {appHasDefaultCredentials, CredentialsSettingsView} from './app-settings-credentials'
import {
	areCustomEnvironmentVariablesEqual,
	areEnvironmentVariablesEqual,
	getCustomEnvironmentVariables,
	getEnvironmentVariableCount,
	getEnvironmentVariables,
	type AppCustomEnvironmentVariable,
	type AppEnvironmentVariable,
} from './app-settings-environment'
import {AppSettingsListContent, AppSettingsListSidebar} from './app-settings-list'
import {
	areCustomMountsEqual,
	areFolderAccessEqual,
	getSelectedFolderAccess,
	StorageSettingsView,
	type AppCustomMount,
	type AppFolderAccessSelection,
} from './app-settings-storage'
import {
	BackButton,
	SettingsControlRow,
	SettingsNavigationRow,
	SettingsViewHeader,
	SettingsViewTransition,
} from './shared'

type AppSettingsView = 'home' | 'storage' | 'connections' | 'credentials' | 'advanced' | 'environment'

export function AppSettingsDialog({
	onInstallDependency,
	makeDependencyPath = registryAppPath,
}: {
	onInstallDependency?: InstallDependency
	makeDependencyPath?: (app: RegistryApp) => string
} = {}) {
	const navigate = useNavigate()
	const {params} = useQueryParams()
	const appId = params.get(getDialogParamKey('app-settings', 'for'))
	const dependencyId = params.get(getDialogParamKey('app-settings', 'dependency')) ?? undefined
	// Deep-link straight to a view, e.g. a failed app's tile opens its storage settings
	const viewParam = params.get(getDialogParamKey('app-settings', 'view'))
	const openView = viewParam === 'storage' ? viewParam : undefined

	const dialogProps = useDialogOpenProps('app-settings')
	// Settings → App settings opens this same dialog at its app-list step (the
	// route only claims the pathname). Everywhere else — e.g. an app's context
	// menu — the ?dialog params open an app's settings directly, with no list
	// step and no back button.
	const openedFromAppsList = useLocation().pathname === '/settings/apps'
	const userQ = trpcReact.user.get.useQuery()
	const listMode = openedFromAppsList && userQ.data?.role === 'owner'

	const {isLoading, app} = useUserApp(appId)
	const {userApps, userAppsKeyed} = useApps()
	const {apps: availableApps, appsKeyed: availableAppsKeyed, ambiguousAppIds} = useAllAvailableApps()

	// Slots let the per-app view own its sidebar and footer (they depend on its
	// draft state) while the dialog shell itself persists across the list ↔ app
	// transition instead of remounting per view.
	const [sideSlot, setSideSlot] = useState<HTMLDivElement | null>(null)
	const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null)
	// The per-app view's guarded close (confirms unsaved changes); null while
	// the list is showing
	const closeRequestRef = useRef<(() => void) | null>(null)

	const appReady = Boolean(
		!isLoading && app && userApps && userAppsKeyed && availableApps && availableAppsKeyed && ambiguousAppIds,
	)
	const showApp = Boolean(appId) && appReady
	const open = dialogProps.open || listMode
	if (!listMode && !showApp) return null

	const closeNow = () => {
		if (openedFromAppsList) navigate('/settings')
		else dialogProps.onOpenChange(false)
	}

	return (
		<ImmersiveDialog
			open={open}
			onOpenChange={(open) => {
				if (open) dialogProps.onOpenChange(true)
				else (closeRequestRef.current ?? closeNow)()
			}}
		>
			<ImmersiveDialogSplitContent
				side={showApp ? <div ref={setSideSlot} className='contents' /> : <AppSettingsListSidebar />}
				footer={<div ref={setFooterSlot} className='contents' />}
				onOpenAutoFocus={(e) => {
					// `preventDefault` to prevent focus on first input
					e.preventDefault()
				}}
			>
				<SettingsViewTransition viewKey={showApp ? `app-${app!.id}` : 'list'} depth={showApp ? 1 : 0}>
					{showApp ? (
						<AppSettingsDialogForApp
							// Switching apps starts a fresh form. Settings refreshes for the same
							// app are reconciled by field below so unrelated drafts survive.
							key={app!.id}
							app={app!}
							userApps={userApps!}
							userAppsKeyed={userAppsKeyed!}
							availableApps={availableApps!}
							availableAppsKeyed={availableAppsKeyed!}
							ambiguousAppIds={ambiguousAppIds!}
							openDependency={dependencyId}
							openView={openView}
							onInstallDependency={onInstallDependency}
							makeDependencyPath={makeDependencyPath}
							sideSlot={sideSlot}
							footerSlot={footerSlot}
							closeRequestRef={closeRequestRef}
							onRequestClose={closeNow}
							onBack={listMode ? () => navigate('/settings/apps') : undefined}
						/>
					) : (
						<AppSettingsListContent />
					)}
				</SettingsViewTransition>
			</ImmersiveDialogSplitContent>
		</ImmersiveDialog>
	)
}

function areSelectionsEqual(a?: Record<string, string>, b?: Record<string, string>) {
	if (a === b) return true
	const keys1 = Object.keys((a ||= {}))
	const keys2 = Object.keys((b ||= {}))
	if (keys1.length !== keys2.length) return false
	for (const key of keys1) {
		if (b[key] !== a[key]) return false
	}
	return true
}

function getAppProxyAuthEnabled(app: UserApp) {
	return app.appProxyAuth?.enabled !== false
}

function getAppStorageSnapshot(app: UserApp) {
	const customMounts = app.storage?.customMounts ?? []
	const folderAccess = getSelectedFolderAccess(app)
	const revision = JSON.stringify({
		customMounts: [...customMounts].sort((a, b) =>
			`${a.serviceName}:${a.targetPath}`.localeCompare(`${b.serviceName}:${b.targetPath}`),
		),
		folderAccess: [...folderAccess].sort((a, b) => a.id.localeCompare(b.id)),
	})

	return {customMounts, folderAccess, revision}
}

function AppSettingsDialogForApp({
	app,
	userApps,
	userAppsKeyed,
	availableApps,
	availableAppsKeyed,
	ambiguousAppIds,
	openDependency,
	openView,
	onInstallDependency,
	makeDependencyPath,
	sideSlot,
	footerSlot,
	closeRequestRef,
	onRequestClose,
	onBack,
}: {
	app: UserApp
	userApps: UserApp[]
	userAppsKeyed: Record<string, UserApp>
	availableApps: RegistryApp[]
	availableAppsKeyed: Record<string, RegistryApp>
	ambiguousAppIds: ReadonlySet<string>
	openDependency?: string
	openView?: AppSettingsView
	onInstallDependency?: InstallDependency
	makeDependencyPath: (app: RegistryApp) => string
	/** Shell slots owned by AppSettingsDialog; the sidebar and footer render
	 * through portals because they depend on this view's draft state. */
	sideSlot: HTMLDivElement | null
	footerSlot: HTMLDivElement | null
	/** Registered so the shell's close affordances run the unsaved-changes guard */
	closeRequestRef: React.MutableRefObject<(() => void) | null>
	onRequestClose: () => void
	/** Present when the dialog opened at its app-list step; renders the back button */
	onBack?: () => void
}) {
	const {t, i18n} = useTranslation()
	const navigate = useNavigate()
	const [view, setView] = useState<AppSettingsView>(openView ?? (openDependency ? 'connections' : 'home'))
	const [selectedDependencies, setSelectedDependencies] = useState(app.selectedDependencies)
	const [customMounts, setCustomMounts] = useState<AppCustomMount[]>(app.storage?.customMounts ?? [])
	const [folderAccess, setFolderAccess] = useState<AppFolderAccessSelection[]>(getSelectedFolderAccess(app))
	const [environmentVariables, setEnvironmentVariables] = useState<AppEnvironmentVariable[]>(
		getEnvironmentVariables(app),
	)
	const [customEnvironmentVariables, setCustomEnvironmentVariables] = useState<AppCustomEnvironmentVariable[]>(
		getCustomEnvironmentVariables(app),
	)
	const [authEnableConfirmOpen, setAuthEnableConfirmOpen] = useState(false)
	const [authDisableConfirmOpen, setAuthDisableConfirmOpen] = useState(false)
	// A discard confirmation holding the action to run once the user lets go of
	// their unsaved changes (closing the dialog, or navigating elsewhere)
	const [pendingDiscardAction, setPendingDiscardAction] = useState<(() => void) | null>(null)
	const storageSnapshot = getAppStorageSnapshot(app)
	const storageSnapshotRef = useRef(storageSnapshot)
	storageSnapshotRef.current = storageSnapshot
	const storageRevision = storageSnapshot.revision
	const previousStorageRevisionRef = useRef(storageRevision)
	const utils = trpcReact.useUtils()
	const invalidateApp = () => {
		// Invalidate this app's state
		utils.apps.state.invalidate({appId: app.id})
		// Invalidate list of apps on desktop
		utils.apps.list.invalidate()
	}
	const onMutationError = (error: {message: string}) => {
		const code = getErrorCode(error.message)
		const message =
			code === 'apps-settings-in-progress' || code === 'apps-settings-blocked'
				? t('app-settings.save-busy-error', {app: app.name})
				: stripErrorCode(error.message)
		toast.error(t('app-settings.save-error', {message}))
	}
	// One mutation for all batched settings (including dependencies) so a
	// combined save restarts the app at most once. Errors are handled explicitly
	// in onSubmit to keep the draft open when validation fails.
	const setSettingsMut = trpcReact.apps.setSettings.useMutation({
		onSuccess: invalidateApp,
	})
	// Umbrel login applies instantly through the app gateway (no restart), so it
	// gets its own mutation instead of joining the batched save
	const setAuthMut = trpcReact.apps.setSettings.useMutation({
		onSuccess: invalidateApp,
		onError: onMutationError,
	})

	// A backend settings event updates the persisted storage snapshot. Reconcile
	// only the storage draft; environment, dependency, and auth edits, and the
	// current view remain untouched.
	useEffect(() => {
		if (previousStorageRevisionRef.current === storageRevision) return
		previousStorageRevisionRef.current = storageRevision
		setCustomMounts(storageSnapshotRef.current.customMounts)
		setFolderAccess(storageSnapshotRef.current.folderAccess)
	}, [storageRevision])

	const dependencies = useMemo(
		() => getDependencyAlternatives(app.dependencies, availableApps, userAppsKeyed, ambiguousAppIds),
		[app.dependencies, availableApps, userAppsKeyed, ambiguousAppIds],
	)

	const areAllDependenciesInstalled = dependencies.every(({dependencyId, appIds}) =>
		appIds.some((appId) =>
			userApps.some(
				(installedApp) =>
					installedApp.id === selectedDependencies[dependencyId] &&
					installedApp.id === appId &&
					arrayIncludes(installedStates, installedApp.state),
			),
		),
	)

	async function onSubmit() {
		const saveDependencies = hasDependencyChanges && areAllDependenciesInstalled
		const settings = {
			appId: app.id,
			...(saveDependencies && {dependencies: selectedDependencies}),
			...(hasStorageSettingsChanges && {customMounts, folderAccess}),
			...(hasEnvironmentVariableChanges && {environment: environmentVariables}),
			...(hasCustomEnvironmentVariableChanges && {customEnvironment: customEnvironmentVariables}),
		}
		try {
			await setSettingsMut.mutateAsync(settings)
		} catch (error) {
			// The settings mutation has no hook-level onError (see above)
			onMutationError(error as {message: string})
			return
		}
		// Saving from the list flow lands back on the list, like closing used to
		// reveal it; otherwise the dialog closes
		if (onBack) onBack()
		else onRequestClose()
	}

	const inProgress = arrayIncludes(progressStates, app.state)
	const hasDependencyChanges = !areSelectionsEqual(app.selectedDependencies, selectedDependencies)
	const hasCustomMountChanges = !areCustomMountsEqual(app.storage?.customMounts, customMounts)
	const hasFolderAccessChanges = !areFolderAccessEqual(getSelectedFolderAccess(app), folderAccess)
	const hasStorageSettingsChanges = hasCustomMountChanges || hasFolderAccessChanges
	const hasEnvironmentVariableChanges = !areEnvironmentVariablesEqual(
		getEnvironmentVariables(app),
		environmentVariables,
	)
	const hasCustomEnvironmentVariableChanges = !areCustomEnvironmentVariablesEqual(
		getCustomEnvironmentVariables(app),
		customEnvironmentVariables,
	)
	const hasEnvironmentChanges = hasEnvironmentVariableChanges || hasCustomEnvironmentVariableChanges
	const hasChanges = hasDependencyChanges || hasStorageSettingsChanges || hasEnvironmentChanges
	const changedSectionCount = [hasDependencyChanges, hasStorageSettingsChanges, hasEnvironmentChanges].filter(
		Boolean,
	).length
	const mutationInProgress = setSettingsMut.isPending
	const saveDisabled =
		!hasChanges ||
		inProgress ||
		mutationInProgress ||
		// The instant auth toggle holds the same backend settings lock, so a
		// batched save fired alongside it would be rejected as concurrent
		setAuthMut.isPending ||
		(hasDependencyChanges && !areAllDependenciesInstalled)
	// Stopped apps keep their manual stop, and unknown auto-start apps retry
	// after saving because the setting change may be fixing why they failed to
	// start
	const willRestartOnSave =
		app.state === 'ready' || app.state === 'running' || (app.state === 'unknown' && app.autoStart)
	const saveLabel = willRestartOnSave ? t('app-settings.save-and-restart') : t('app-settings.save-changes')

	const resetChanges = () => {
		setSelectedDependencies(app.selectedDependencies)
		setCustomMounts(app.storage?.customMounts ?? [])
		setFolderAccess(getSelectedFolderAccess(app))
		setEnvironmentVariables(getEnvironmentVariables(app))
		setCustomEnvironmentVariables(getCustomEnvironmentVariables(app))
	}

	// Every way out of the dialog runs through here so unsaved changes are never
	// dropped silently. A save already in flight isn't discardable, so it
	// doesn't count as dirty.
	const confirmDiscardThen = (action: () => void) => {
		if (hasChanges && !mutationInProgress) {
			setPendingDiscardAction(() => action)
		} else {
			action()
		}
	}
	const requestClose = () => confirmDiscardThen(onRequestClose)
	const navigateAway = (to: string) => confirmDiscardThen(() => navigate(to))

	// The shell's close affordances (esc, outside click, X) call this instead of
	// closing directly, so they hit the same discard guard
	useEffect(() => {
		closeRequestRef.current = requestClose
	})
	useEffect(() => {
		return () => {
			closeRequestRef.current = null
		}
	}, [closeRequestRef])

	// Umbrel login is applied instantly after any required confirmation. Turning
	// it off always warns about exposing the app; turning it on also warns when
	// the developer ships it off because login may break clients or integrations.
	const appProxyAuthSupported = app.appProxyAuth?.supported === true
	const appProxyAuthDefaultEnabled = app.appProxyAuth?.defaultEnabled === true
	const savedAuthEnabled = getAppProxyAuthEnabled(app)
	const pendingAuthValue = setAuthMut.isPending ? setAuthMut.variables?.appProxyAuthEnabled : undefined
	const authEnabled =
		pendingAuthValue === undefined ? savedAuthEnabled : (pendingAuthValue ?? appProxyAuthDefaultEnabled)
	const setAuthEnabled = (enabled: boolean) =>
		setAuthMut.mutate({
			appId: app.id,
			// null clears the override so the app follows its default
			appProxyAuthEnabled: appProxyAuthDefaultEnabled === enabled ? null : enabled,
		})
	const onAuthToggle = (enabled: boolean) => {
		if (!enabled) setAuthDisableConfirmOpen(true)
		else if (!appProxyAuthDefaultEnabled) setAuthEnableConfirmOpen(true)
		else setAuthEnabled(true)
	}

	// Home rows explain what each section contains. Actionable states replace
	// that description so problems remain visible before opening the section.
	const storageSupported = Boolean(
		app.storage && (app.storage.dataRoot || app.storage.folderAccess.length > 0 || app.storage.services.length > 0),
	)
	const storageUnavailable = (app.storage?.missingSourcePaths.length ?? 0) > 0
	const storageDescription = !storageSupported ? (
		t('app-settings.storage.none')
	) : app.storage?.dataRoot?.status === 'storage-unavailable' ? (
		<span className='text-yellow-200/70'>{t('app-settings.storage.app-storage-unavailable')}</span>
	) : app.storage?.dataRoot?.status === 'data-missing' ? (
		<span className='text-yellow-200/70'>{t('app-settings.storage.app-data-missing-short')}</span>
	) : app.storage?.dataRoot?.status === 'checking' ? (
		t('app-settings.storage.checking-description')
	) : storageUnavailable ? (
		<span className='text-yellow-200/70'>{t('app-settings.warning.folder-access')}</span>
	) : (
		t('app-settings.storage.page-description')
	)

	const hasConnections = dependencies.length > 0
	const selectedConnectionNames = (app.dependencies ?? []).map((dependencyId) => {
		const selectedAppId = selectedDependencies[dependencyId] ?? dependencyId
		return userAppsKeyed[selectedAppId]?.name ?? availableAppsKeyed[selectedAppId]?.name ?? selectedAppId
	})
	const connectionsDescription = hasConnections
		? new Intl.ListFormat(i18n.language, {style: 'long', type: 'conjunction'}).format(selectedConnectionNames)
		: t('app-settings.connections.none')

	const hasCredentials = appHasDefaultCredentials(app)
	const home = (
		<div className='flex flex-col gap-y-5'>
			{onBack ? (
				<BackButton onClick={() => confirmDiscardThen(onBack)}>{t('app-settings-list.title')}</BackButton>
			) : null}

			{/* The identity pane is hidden below md, so small screens get it inline */}
			<div className='flex items-center gap-3 md:hidden'>
				<AppIcon src={app.icon} size={40} className='rounded-8' />
				<div className='min-w-0'>
					<div className='truncate text-15 font-medium'>{app.name}</div>
					{app.version ? (
						<div className='text-12 text-white/40'>{t('app-settings.version', {version: app.version})}</div>
					) : null}
				</div>
			</div>

			<SettingsViewHeader title={t('app-settings.title')} description={t('app-settings.description')} />

			<div className='flex flex-col gap-y-3'>
				<SettingsControlRow
					title={t('app-settings.auth.row-title')}
					description={appProxyAuthSupported ? t('app-settings.auth.description') : t('app-settings.auth.unsupported')}
					icon={TbLock}
					tone={1}
					control={
						appProxyAuthSupported ? (
							<Switch checked={authEnabled} disabled={setAuthMut.isPending} onCheckedChange={onAuthToggle} />
						) : undefined
					}
				/>
				<SettingsNavigationRow
					title={t('app-settings.storage.title')}
					description={storageDescription}
					onClick={storageSupported ? () => setView('storage') : undefined}
					modified={hasStorageSettingsChanges}
					icon={TbDatabase}
					tone={2}
				/>
				<SettingsNavigationRow
					title={t('app-settings.connections.title')}
					description={connectionsDescription}
					onClick={hasConnections ? () => setView('connections') : undefined}
					modified={hasDependencyChanges}
					icon={TbPlugConnected}
					tone={3}
				/>
				<SettingsNavigationRow
					title={t('app-settings.credentials.title')}
					description={hasCredentials ? t('app-settings.credentials.description') : t('app-settings.credentials.none')}
					onClick={hasCredentials ? () => setView('credentials') : undefined}
					icon={TbKey}
					tone={4}
				/>
				<SettingsNavigationRow
					title={t('app-settings.advanced.title')}
					description={t('app-settings.advanced.description')}
					onClick={() => setView('advanced')}
					modified={hasEnvironmentChanges}
					icon={TbAdjustmentsHorizontal}
					tone={5}
				/>
			</div>
		</div>
	)

	const connections = (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={() => setView('home')}>{t('app-settings.title')}</BackButton>

			<SettingsViewHeader
				title={t('app-settings.connections.title')}
				description={t('app-settings.connected-to', {appName: app.name})}
			/>

			<SelectDependencies
				dependencies={dependencies}
				selectedDependencies={selectedDependencies}
				setSelectedDependencies={setSelectedDependencies}
				onLeave={(afterLeave) =>
					confirmDiscardThen(() => {
						onRequestClose()
						afterLeave?.()
					})
				}
				highlightDependency={openDependency}
				onInstallDependency={onInstallDependency}
				makeDependencyPath={makeDependencyPath}
			/>
		</div>
	)

	const storage = (
		<StorageSettingsView
			app={app}
			userApps={userApps}
			customMounts={customMounts}
			setCustomMounts={setCustomMounts}
			folderAccess={folderAccess}
			setFolderAccess={setFolderAccess}
			onBack={() => setView('home')}
		/>
	)

	const content =
		view === 'home' ? (
			home
		) : view === 'connections' ? (
			connections
		) : view === 'credentials' ? (
			<CredentialsSettingsView app={app} onBack={() => setView('home')} />
		) : view === 'advanced' ? (
			<AdvancedSettingsView
				app={app}
				variableCount={getEnvironmentVariableCount(environmentVariables, customEnvironmentVariables)}
				variablesModified={hasEnvironmentChanges}
				onBack={() => setView('home')}
				onEnvironmentVariables={() => setView('environment')}
				onNavigate={navigateAway}
			/>
		) : view === 'environment' ? (
			<EnvironmentSettingsView
				app={app}
				variables={environmentVariables}
				setVariables={setEnvironmentVariables}
				customVariables={customEnvironmentVariables}
				setCustomVariables={setCustomEnvironmentVariables}
				onBack={() => setView('advanced')}
			/>
		) : (
			storage
		)

	const pendingChangesBar = (
		<AnimatePresence>
			{hasChanges && (
				<motion.div
					initial={{y: 56, opacity: 0}}
					animate={{y: 0, opacity: 1}}
					exit={{y: 56, opacity: 0}}
					transition={{duration: 0.2, ease: 'easeOut'}}
					className='border-t border-white/6 bg-black/30'
				>
					<div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 md:px-8'>
						<div className='text-13 text-white/50'>
							{t('app-settings.pending-changes', {count: changedSectionCount})}
						</div>
						<div className='flex items-center gap-2'>
							<Button size='dialog' className='w-auto' disabled={mutationInProgress} onClick={resetChanges}>
								{t('app-settings.discard')}
							</Button>
							<Button variant='primary' size='dialog' className='w-auto' disabled={saveDisabled} onClick={onSubmit}>
								{inProgress ? appStateToString(app.state, t) + '...' : saveLabel}
							</Button>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	)

	return (
		<>
			<div aria-disabled={mutationInProgress} className={cn(mutationInProgress && 'pointer-events-none')}>
				<SettingsViewTransition viewKey={view} depth={view === 'home' ? 0 : view === 'environment' ? 2 : 1}>
					{content}
				</SettingsViewTransition>
			</div>
			{sideSlot ? createPortal(<AppSettingsSidebar app={app} onNavigate={navigateAway} />, sideSlot) : null}
			{footerSlot ? createPortal(pendingChangesBar, footerSlot) : null}

			<AlertDialog open={authEnableConfirmOpen} onOpenChange={setAuthEnableConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader icon={TbInfoCircle}>
						<AlertDialogTitle>{t('app-settings.auth.confirm-enable-title', {app: app.name})}</AlertDialogTitle>
						<AlertDialogDescription>{t('app-settings.auth.confirm-enable-description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='primary'
							onClick={() => {
								setAuthEnableConfirmOpen(false)
								setAuthEnabled(true)
							}}
						>
							{t('app-settings.auth.confirm-enable-action')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={authDisableConfirmOpen} onOpenChange={setAuthDisableConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader icon={TbAlertTriangle}>
						<AlertDialogTitle>{t('app-settings.auth.confirm-disable-title', {app: app.name})}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('app-settings.auth.confirm-disable-description', {app: app.name})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='destructive'
							onClick={() => {
								setAuthDisableConfirmOpen(false)
								setAuthEnabled(false)
							}}
						>
							{t('app-settings.auth.confirm-disable-action')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				open={pendingDiscardAction !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDiscardAction(null)
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader icon={TbAlertTriangle}>
						<AlertDialogTitle>{t('app-settings.discard-title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('app-settings.discard-description', {app: app.name})}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='destructive'
							onClick={() => {
								const action = pendingDiscardAction
								setPendingDiscardAction(null)
								resetChanges()
								action?.()
							}}
						>
							{t('app-settings.discard')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('app-settings.keep-editing')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

function AppSettingsSidebar({app, onNavigate}: {app: UserApp; onNavigate: (to: string) => void}) {
	const {t} = useTranslation()
	const {resolvedAppsKeyed} = useAllAvailableApps()
	const registryApp = resolvedAppsKeyed?.[app.id]
	const hasUpdate = Boolean(app.version) && isAppUpdateAvailable(app.version, registryApp)
	// No link when the app is gone from every registry — there is no store page
	const storePath = registryApp ? registryAppPath(registryApp) : null

	return (
		<div className='flex w-full flex-col items-center gap-0.5 px-4 text-center'>
			<AppIcon src={app.icon} size={64} className='rounded-15' />
			<div className='mt-2.5 w-full truncate text-15 font-medium' title={app.name}>
				{app.name}
			</div>
			{app.version ? (
				<div className='w-full truncate text-13 text-white/40'>{t('app-settings.version', {version: app.version})}</div>
			) : null}
			{hasUpdate ? (
				// The updates dialog lives in the App Store header, so the button
				// leads there with it open
				<Button size='sm' className='mt-2' onClick={() => onNavigate('/app-store?dialog=updates')}>
					{t('app-settings.update-available')}
				</Button>
			) : null}
			{storePath ? (
				<button
					type='button'
					onClick={() => onNavigate(storePath)}
					className='mt-3 text-12 font-medium text-white/40 transition-colors hover:text-white/60'
				>
					{t('app-settings.view-in-app-store')}
				</button>
			) : null}
		</div>
	)
}
