import {useEffect, type Dispatch, type SetStateAction} from 'react'
import {useTranslation} from 'react-i18next'
import {TbFileText, TbTerminal2, TbVariable} from 'react-icons/tb'
import {type To} from 'react-router-dom'

import {prefetchGlobalDialog} from '@/modules/global-dialogs'
import {UserApp} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

import {
	EnvironmentVariablesSettings,
	type AppCustomEnvironmentVariable,
	type AppEnvironmentVariable,
} from './app-settings-environment'
import {BackButton, SettingsNavigationRow, SettingsViewHeader} from './shared'

export function AdvancedSettingsView({
	app,
	variableCount,
	variablesModified,
	onBack,
	onEnvironmentVariables,
	onNavigate,
}: {
	app: UserApp
	variableCount: number
	variablesModified: boolean
	onBack: () => void
	onEnvironmentVariables: () => void
	// Routed through the dialog so unsaved changes are confirmed before leaving
	onNavigate: (to: To) => void
}) {
	const {t} = useTranslation()
	const linkToDialog = useLinkToDialog()

	// The terminal and logs are a click away, and take this dialog's place the moment they can mount
	useEffect(() => {
		prefetchGlobalDialog('terminal')
		prefetchGlobalDialog('troubleshoot')
	}, [])

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('app-settings.title')}</BackButton>

			<SettingsViewHeader
				title={t('app-settings.advanced.title')}
				description={t('app-settings.advanced.description')}
			/>

			<div className='flex flex-col gap-y-3'>
				<SettingsNavigationRow
					title={t('app-settings.environment.title')}
					description={
						variableCount > 0
							? t('app-settings.advanced.variables-set', {count: variableCount})
							: t('app-settings.advanced.variables-none')
					}
					onClick={onEnvironmentVariables}
					modified={variablesModified}
					icon={TbVariable}
					tone={1}
				/>
				<SettingsNavigationRow
					title={t('app-settings.advanced.open-terminal')}
					description={t('app-settings.advanced.open-terminal-description', {app: app.name})}
					onClick={() => onNavigate(linkToDialog('terminal', {for: app.id}))}
					icon={TbTerminal2}
					tone={2}
				/>
				<SettingsNavigationRow
					title={t('app-settings.advanced.view-logs')}
					description={t('app-settings.advanced.view-logs-description', {app: app.name})}
					onClick={() => onNavigate(linkToDialog('troubleshoot', {for: app.id}))}
					icon={TbFileText}
					tone={3}
				/>
			</div>
		</div>
	)
}

export function EnvironmentSettingsView({
	app,
	variables,
	setVariables,
	customVariables,
	setCustomVariables,
	onBack,
}: {
	app: UserApp
	variables: AppEnvironmentVariable[]
	setVariables: Dispatch<SetStateAction<AppEnvironmentVariable[]>>
	customVariables: AppCustomEnvironmentVariable[]
	setCustomVariables: Dispatch<SetStateAction<AppCustomEnvironmentVariable[]>>
	onBack: () => void
}) {
	const {t} = useTranslation()

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('app-settings.advanced.title')}</BackButton>

			<SettingsViewHeader
				title={t('app-settings.environment.title')}
				description={t('app-settings.environment.page-description')}
			/>

			<EnvironmentVariablesSettings
				app={app}
				variables={variables}
				setVariables={setVariables}
				customVariables={customVariables}
				setCustomVariables={setCustomVariables}
			/>
		</div>
	)
}
