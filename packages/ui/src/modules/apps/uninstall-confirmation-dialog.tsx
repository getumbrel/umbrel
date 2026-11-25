import type {ReactNode} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbTrash} from 'react-icons/tb'

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
import {PathBreadcrumbs} from '@/features/files/components/shared/path-breadcrumbs'
import {StorageLocation} from '@/features/files/components/storage-location'
import {getAppStorageSourcePaths} from '@/modules/apps/app-storage'
import {useUserApp} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import type {UserApp} from '@/trpc/trpc'

export type AppDataRoot = NonNullable<NonNullable<UserApp['storage']>['dataRoot']>

export function UninstallConfirmationContent({
	appName,
	appIcon,
	dataRoot,
	folderAccessPaths = [],
	renderFolderAccessPath,
	onConfirm,
}: {
	appName: string
	appIcon?: string
	dataRoot?: AppDataRoot | null
	folderAccessPaths?: string[]
	renderFolderAccessPath?: (path: string) => ReactNode
	onConfirm: () => void
}) {
	const {t} = useTranslation()
	const dataRootLocation = dataRoot?.location
	const dataRootWarning =
		dataRoot?.status === 'storage-unavailable' || dataRoot?.status === 'data-missing' || dataRoot?.status === 'checking'
	const requiresUninstallAnyway = dataRoot?.status === 'storage-unavailable' || dataRoot?.status === 'data-missing'
	const renderPath =
		renderFolderAccessPath ?? ((path: string) => <PathBreadcrumbs path={path} className='text-13 text-white/85' />)
	const description: {title?: string; message: string} = (() => {
		if (!dataRootLocation) return {message: t('app.uninstall.confirm.description-internal')}
		if (dataRoot.status === 'available') return {message: t('app.uninstall.confirm.description-connected')}
		if (dataRoot.status === 'storage-unavailable') {
			return {
				title: t('app.uninstall.confirm.description-unavailable-title'),
				message: t('app.uninstall.confirm.description-unavailable'),
			}
		}
		if (dataRoot.status === 'data-missing') {
			return {
				title: t('app.uninstall.confirm.description-missing-title'),
				message: t('app.uninstall.confirm.description-missing'),
			}
		}
		return {
			title: t('app.uninstall.confirm.description-checking-title'),
			message: t('app.uninstall.confirm.description-checking'),
		}
	})()

	return (
		<AlertDialogContent>
			<AlertDialogHeader>
				{/* App identity with a destructive badge, matching the member and
				    cloud removal confirmations. mt-1 keeps the badge's negative
				    offset inside the header's scroll clip. */}
				<div className='relative mx-auto mt-1 w-fit'>
					<AppIcon src={appIcon} size={64} className='rounded-15' />
					<div className='absolute -top-1 -right-1 grid size-6 place-items-center rounded-full bg-destructive2 shadow-md'>
						<TbTrash className='size-3.5 text-white' />
					</div>
				</div>
				<AlertDialogTitle>{t('app.uninstall.confirm.title', {app: appName})}</AlertDialogTitle>
				<AlertDialogDescription asChild>
					{dataRootWarning ? (
						<div className='rounded-12 bg-[#F5A623]/10 p-3.5 text-left'>
							<div className='flex items-start gap-2.5'>
								<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-[#F5A623]' />
								<div className='min-w-0 space-y-1'>
									<p className='font-semibold text-white/85'>{description.title}</p>
									<p className='text-12 leading-relaxed text-white/60'>{description.message}</p>
								</div>
							</div>
							<div className='mt-3 flex items-center justify-between gap-3 rounded-8 bg-white/5 px-3 py-2.5'>
								<StorageLocation
									path={dataRootLocation!}
									connected={dataRoot.status !== 'storage-unavailable'}
									className='text-13 font-medium text-white/80'
									iconClassName='size-5'
								/>
								<span className='shrink-0 text-11 text-white/40'>
									{t(
										dataRoot.status === 'storage-unavailable'
											? 'app.uninstall.confirm.storage-disconnected'
											: dataRoot.status === 'data-missing'
												? 'app.uninstall.confirm.storage-data-missing'
												: 'app-settings.storage.checking',
									)}
								</span>
							</div>
						</div>
					) : (
						<div className='space-y-3'>
							<div className='space-y-1.5'>
								{description.title ? <p className='font-medium text-white/85'>{description.title}</p> : null}
								<p className={description.title ? undefined : 'font-medium text-white/85'}>{description.message}</p>
							</div>
							{dataRootLocation ? (
								<div className='flex justify-center rounded-12 bg-white/5 px-3 py-2.5'>
									<StorageLocation
										path={dataRootLocation}
										className='text-14 font-medium text-white/80'
										iconClassName='size-7'
									/>
								</div>
							) : null}
						</div>
					)}
				</AlertDialogDescription>
			</AlertDialogHeader>
			{folderAccessPaths.length ? (
				<div className='space-y-2 text-left'>
					<p className='text-13 leading-tight text-white/60'>
						<Trans
							t={t}
							i18nKey='app.uninstall.confirm.folder-access-note'
							values={{app: appName}}
							components={{highlight: <span className='font-semibold text-white' />}}
						/>
					</p>
					<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						{folderAccessPaths.map((path) => (
							<div key={path} className='px-3.5 py-2.5'>
								{renderPath(path)}
							</div>
						))}
					</div>
				</div>
			) : null}
			<AlertDialogFooter>
				<AlertDialogAction variant='destructive' onClick={onConfirm}>
					{requiresUninstallAnyway ? t('app.uninstall.confirm.submit-anyway') : t('app.uninstall.confirm.submit')}
				</AlertDialogAction>
				<AlertDialogCancel autoFocus>{t('cancel')}</AlertDialogCancel>
			</AlertDialogFooter>
		</AlertDialogContent>
	)
}

export function UninstallConfirmationDialog({
	open,
	onOpenChange,
	appId,
	onConfirm,
}: {
	appId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
}) {
	const {t} = useTranslation()
	const {appsKeyed, isLoading} = useAllAvailableApps()
	const {app, isLoading: isInstalledAppLoading} = useUserApp(appId)
	const availableApp = appsKeyed?.[appId]

	if (isLoading || isInstalledAppLoading) return null
	// The app may have been removed from the app store, so the installed app is
	// authoritative and the catalog is only a fallback for its display name.
	if (!app && !availableApp) {
		console.error(`${appId} not found`)
	}

	const appName = app?.name ?? availableApp?.name ?? t('app')
	const dataRoot = app?.storage?.dataRoot
	// The data root is covered by the dialog copy above; only shared folders
	// stay behind after an uninstall and need listing here
	const folderAccessPaths = app ? getAppStorageSourcePaths(app, {includeDataRoot: false}) : []

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<UninstallConfirmationContent
				appName={appName}
				appIcon={app?.icon ?? availableApp?.icon}
				dataRoot={dataRoot}
				folderAccessPaths={folderAccessPaths}
				onConfirm={onConfirm}
			/>
		</AlertDialog>
	)
}
