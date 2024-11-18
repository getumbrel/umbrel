import prettyBytes from 'pretty-bytes'
import {forwardRef, useImperativeHandle, useState} from 'react'
import {useTimeout} from 'react-use'
import semver from 'semver'
import {arrayIncludes} from 'ts-extras'

import {useAppInstall} from '@/hooks/use-app-install'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useVersion} from '@/hooks/use-version'
import {OSUpdateRequiredDialog} from '@/modules/app-store/os-update-required'
import {SelectDependenciesDialog} from '@/modules/app-store/select-dependencies-dialog'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {installedStates, RegistryApp} from '@/trpc/trpc'

import {InstallButton} from './install-button'

export const InstallButtonConnected = forwardRef(
	(
		{
			app,
		}: {
			app: RegistryApp
		},
		ref,
	) => {
		const appInstall = useAppInstall(app.id)
		const {apps} = useAllAvailableApps()
		const [showDepsDialog, setShowDepsDialog] = useState(false)
		const [showOSUpdateRequiredDialog, setShowOSUpdateRequiredDialog] = useState(false)
		const {userAppsKeyed, isLoading} = useApps()
		const openApp = useLaunchApp()
		const [selections, setSelections] = useState({} as Record<string, string>)
		const os = useVersion()
		const [show] = useTimeout(400)
		const [highlightDependency, setHighlightDependency] = useState<string | undefined>(undefined)

		useImperativeHandle(ref, () => ({
			triggerInstall(highlightDependency?: string) {
				setHighlightDependency(highlightDependency)
				triggerInstall()
			},
		}))

		if (!show() || isLoading || !userAppsKeyed || !apps || os.isLoading) {
			return (
				<InstallButton
					key={app.id}
					installSize={app.installSize ? prettyBytes(app.installSize) : undefined}
					progress={appInstall.progress}
					state='loading'
				/>
			)
		}

		const isInstalled = (appId: string) => arrayIncludes(installedStates, userAppsKeyed[appId]?.state)

		const selectAlternative = (dependencyId: string, appId: string | undefined) => {
			if (appId) selections[dependencyId] = appId
			else delete selections[dependencyId]
			setSelections({...selections})
		}

		const getAppsImplementing = (dependencyId: string) =>
			apps
				// Filter out community apps that aren't installed
				.filter((registryApp) => {
					const isCommunityApp = registryApp.appStoreId !== 'umbrel-app-store'
					return !isCommunityApp || userAppsKeyed[registryApp.id]
				})
				// Prefer installed app over registry app
				.map((registryApp) => userAppsKeyed[registryApp.id] ?? registryApp)
				.filter((applicableApp) => applicableApp.implements?.includes(dependencyId))
				.map((implementingApp) => implementingApp.id)

		// Obtain possible alternatives for each dependency. Groups alternatives for
		// each dependency into a two dimensional array, where each item references
		// both the original dependency and the alterantive app. First item always is
		// the original dependency.
		// [
		//   [{dependencyId, appId: dependencyId}, {dependencyId, appId: implementingId}],
		//   [{dependencyId, appId: dependencyId}],
		// ]
		const dependencies = (app.dependencies ?? []).map((dependencyId) =>
			[dependencyId, ...getAppsImplementing(dependencyId)].map((appId) => ({
				dependencyId,
				appId,
			})),
		)

		// Auto-select the first installed alternative, naturally preferring the original
		// app when it is installed as well.
		dependencies.forEach((alternatives) => {
			alternatives.forEach(({dependencyId, appId}) => {
				if (!selections[dependencyId] && isInstalled(appId)) {
					selectAlternative(dependencyId, appId)
				}
			})
		})

		// TODO: Also check if app is ready? `&& userAppsKeyed[dep].state === 'ready'`
		// Will want to mark apps as in progress so we don't show that an app needs to be installed first
		const areAllAlternativesSelectedAndInstalled = dependencies.every((alternatives) =>
			alternatives.some((app) => selections[app.dependencyId] === app.appId && isInstalled(app.appId)),
		)

		const compatible = semver.lte(app.manifestVersion, os.version)

		const install = () => {
			if (!compatible) {
				setShowOSUpdateRequiredDialog(true)
				return
			}
			if (dependencies.length > 0) {
				return setShowDepsDialog(true)
			}
			appInstall.install()
		}

		function triggerInstall() {
			install()
		}

		const verifyInstall = (selectedDeps: Record<string, string>) => {
			// Currently always the case because AppPermissionsDialog checks
			if (areAllAlternativesSelectedAndInstalled) {
				appInstall.install(selectedDeps)
			}
		}

		return (
			<>
				<InstallButton
					// `key` to prevent framer-motion from thinking install buttons from different pages are the same and animating between them
					key={app.id}
					installSize={app.installSize ? prettyBytes(app.installSize) : undefined}
					// progress={userApp?.installProgress}
					// state={userApp?.state || 'initial'}
					progress={appInstall.progress}
					state={appInstall.state}
					compatible={compatible}
					onInstallClick={install}
					onOpenClick={() => openApp(app.id)}
				/>
				<SelectDependenciesDialog
					appId={app.id}
					dependencies={dependencies}
					open={showDepsDialog}
					onOpenChange={setShowDepsDialog}
					onNext={verifyInstall}
					highlightDependency={highlightDependency}
				/>
				<OSUpdateRequiredDialog
					app={app}
					open={showOSUpdateRequiredDialog}
					onOpenChange={setShowOSUpdateRequiredDialog}
				/>
			</>
		)
	},
)
