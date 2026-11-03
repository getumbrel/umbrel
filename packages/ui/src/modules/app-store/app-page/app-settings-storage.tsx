import {ChevronDown, ChevronRight, Trash2} from 'lucide-react'
import {useState, type Dispatch, type SetStateAction} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbDatabase, TbFolders, TbInfoCircle, TbSettings} from 'react-icons/tb'

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
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {Input, Labeled} from '@/components/ui/input'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import activeNasIcon from '@/features/files/assets/nas-icon-active.png'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {FolderPickerRow, PathBreadcrumbs} from '@/features/files/components/shared/path-breadcrumbs'
import {StorageLocation} from '@/features/files/components/storage-location'
import {EXTERNAL_STORAGE_PATH, HOME_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {cn} from '@/lib/utils'
import {getFolderAccessSourcePath} from '@/modules/apps/app-storage'
import {useGlobalFiles} from '@/providers/global-files'
import {trpcReact, UserApp} from '@/trpc/trpc'
import {stripErrorCode} from '@/utils/backend-error'

import {getAppsUsingSourcePath, StorageSharedFolderHint} from './folder-access-usage'
import {
	AppServiceSelect,
	BackButton,
	FolderAccessPill,
	SettingsAddForm,
	SettingsAddRowButton,
	SettingsControlRow,
	SettingsIconButton,
	SettingsInputHint,
	SettingsNavigationRow,
	SettingsPill,
	settingsPillClass,
	SettingsViewHeader,
	SettingsViewTransition,
} from './shared'
import {
	getManagedDataRootPath,
	getStorageBrowserOpenPath,
	isFolderAccessSourceSelectable,
	isStorageBrowserPath,
	storagePathsOverlap,
} from './storage-paths'

type AppStorageSettings = NonNullable<UserApp['storage']>
export type AppCustomMount = AppStorageSettings['customMounts'][number]
type AppFolderAccessSlot = AppStorageSettings['folderAccess'][number]
export type AppFolderAccessSelection = Pick<AppFolderAccessSlot, 'id'> & {sourcePath: string}
type StorageSettingsSubView = 'storage' | 'folderAccess' | 'advancedFolderAccess'
type StorageActivePicker =
	| {type: 'data-root'}
	| {type: 'custom-mount'; mount: AppCustomMount}
	| {type: 'folder-access'; folder: AppFolderAccessSlot}
	| {type: 'add'}
	| null

// Mounts and folders are compared independently of array order so reapplying the
// same selection doesn't count as a change.
export function areCustomMountsEqual(a: AppCustomMount[] = [], b: AppCustomMount[] = []) {
	if (a.length !== b.length) return false
	const byKey = new Map(b.map((mount) => [getStorageMountKey(mount), mount]))
	return a.every((mount) => {
		const other = byKey.get(getStorageMountKey(mount))
		return other?.sourcePath === mount.sourcePath && other.readOnly === mount.readOnly
	})
}

export function areFolderAccessEqual(a: AppFolderAccessSelection[] = [], b: AppFolderAccessSelection[] = []) {
	if (a.length !== b.length) return false
	const byId = new Map(b.map((folder) => [folder.id, folder]))
	return a.every((folder) => byId.get(folder.id)?.sourcePath === folder.sourcePath)
}

export function getSelectedFolderAccess(app: UserApp): AppFolderAccessSelection[] {
	return (app.storage?.folderAccess ?? []).flatMap((folder) =>
		folder.sourcePath ? [{id: folder.id, sourcePath: folder.sourcePath}] : [],
	)
}

function normalizeContainerPathInput(path: string) {
	const trimmedPath = path.trim()
	if (!trimmedPath.startsWith('/')) return trimmedPath
	return `/${trimmedPath.split('/').filter(Boolean).join('/')}`
}

function isContainerPathInputValid(path: string) {
	const trimmedPath = path.trim()
	if (!trimmedPath.startsWith('/') || /[\0\r\n]/.test(trimmedPath)) return false

	const segments = trimmedPath.split('/').filter(Boolean)
	return segments.length > 0 && segments.every((segment) => segment !== '.' && segment !== '..')
}

function getFolderAccessSelection(folderAccess: AppFolderAccessSelection[], folder: AppFolderAccessSlot) {
	return folderAccess.find((folderAccess) => folderAccess.id === folder.id)
}

function getFolderAccessSource(folderAccess: AppFolderAccessSelection[], folder: AppFolderAccessSlot) {
	return getFolderAccessSelection(folderAccess, folder)?.sourcePath ?? folder.defaultSourcePath ?? undefined
}

function getFolderAccessMountKeys(folder: AppFolderAccessSlot) {
	return folder.mounts.map((mount) => `${mount.serviceName}:${mount.targetPath}`)
}

function getStorageMountKey(mount: Pick<AppCustomMount, 'serviceName' | 'targetPath'>) {
	return `${mount.serviceName}:${mount.targetPath}`
}

export function getCustomMountConflictKeys(
	folderAccessSlots: Array<{id: string; mounts: Array<{serviceName: string; targetPath: string}>}>,
	folderAccess: Array<{id: string}>,
	customMounts: Array<{serviceName: string; targetPath: string}>,
) {
	const selectedFolderIds = new Set(folderAccess.map(({id}) => id))
	return new Set([
		...folderAccessSlots
			.filter(({id}) => selectedFolderIds.has(id))
			.flatMap((folder) => folder.mounts.map(getStorageMountKey)),
		...customMounts.map(getStorageMountKey),
	])
}

export function isDataRootParentSelectable(entry: {path: string}) {
	if (!entry.path.startsWith('/')) return false
	const segments = entry.path.split('/').filter(Boolean)
	return segments[0] === 'External' && segments.length >= 2
}

function getPathName(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? null
}

function getMountName(mount: Pick<AppCustomMount, 'targetPath'>) {
	return getPathName(mount.targetPath)
}

function isRemovableSourcePath(path: string) {
	return path.startsWith(`${EXTERNAL_STORAGE_PATH}/`) || path.startsWith(`${NETWORK_STORAGE_PATH}/`)
}

// App data roots are only supported on ext4. Match by mountpoint segment so a
// similarly prefixed drive label cannot inherit another partition's support.
export function isExt4AppDataRootPath(
	path: string,
	disks: Array<{partitions: Array<{supportsAppDataRoot: boolean; mountpoints: string[]}>}> | undefined,
) {
	for (const disk of disks ?? []) {
		for (const partition of disk.partitions) {
			for (const mountpoint of partition.mountpoints) {
				if (path === mountpoint || path.startsWith(`${mountpoint}/`)) {
					return partition.supportsAppDataRoot
				}
			}
		}
	}
	return false
}

export type DataRootMoveWarning = 'unsupported-filesystem' | 'removable' | null

// Which data-loss warning the move confirmation leads with, most severe
// first: a filesystem that can't hold Linux ownership breaks apps outright;
// otherwise any external drive can be unplugged. null means moving back to
// internal storage.
export function getDataRootMoveWarning(
	parentPath: string | null | undefined,
	disks: Array<{partitions: Array<{supportsAppDataRoot: boolean; mountpoints: string[]}>}> | undefined,
): DataRootMoveWarning {
	if (!parentPath) return null
	if (!isDataRootParentSelectable({path: parentPath})) return null
	if (!isExt4AppDataRootPath(parentPath, disks)) return 'unsupported-filesystem'
	return 'removable'
}

function getDataRootParentPath(path: string) {
	const lastSlash = path.lastIndexOf('/')
	return lastSlash > 0 ? path.slice(0, lastSlash) : path
}

function getDataRootDestinationPath(parentPath: string, appId: string) {
	return `${parentPath}/${appId}`
}

export function StorageSettingsView({
	app,
	userApps,
	customMounts,
	setCustomMounts,
	folderAccess,
	setFolderAccess,
	onBack,
}: {
	app: UserApp
	userApps: UserApp[]
	customMounts: AppCustomMount[]
	setCustomMounts: Dispatch<SetStateAction<AppCustomMount[]>>
	folderAccess: AppFolderAccessSelection[]
	setFolderAccess: Dispatch<SetStateAction<AppFolderAccessSelection[]>>
	onBack: () => void
}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const {operations} = useGlobalFiles()
	const missingSourcePaths = new Set(app.storage?.missingSourcePaths ?? [])
	const folderAccessMissingSourcePaths = (app.storage?.folderAccess ?? []).flatMap((folder) => {
		const sourcePath = getFolderAccessSourcePath(folder)
		return sourcePath && missingSourcePaths.has(sourcePath) ? [sourcePath] : []
	})
	const customMountMissingSourcePaths = customMounts.flatMap((mount) =>
		missingSourcePaths.has(mount.sourcePath) ? [mount.sourcePath] : [],
	)
	const [activePicker, setActivePicker] = useState<StorageActivePicker>(null)
	const [pendingDataRootParentPath, setPendingDataRootParentPath] = useState<string | null | undefined>()
	const [resetDataRootOpen, setResetDataRootOpen] = useState(false)
	const [storageSubView, setStorageSubView] = useState<StorageSettingsSubView>(() => {
		const dataRootStatus = app.storage?.dataRoot?.status
		const dataRootNeedsAttention = dataRootStatus === 'storage-unavailable' || dataRootStatus === 'data-missing'
		if (dataRootNeedsAttention) return 'storage'

		if (folderAccessMissingSourcePaths.length > 0) return 'folderAccess'
		if (customMountMissingSourcePaths.length > 0) return 'advancedFolderAccess'
		return 'storage'
	})
	const [customFolderFormOpen, setCustomFolderFormOpen] = useState(false)
	const folderAccessSlots = app.storage?.folderAccess ?? []
	const requiredFolderSlots = folderAccessSlots.filter((folder) => folder.defaultSourcePath)
	const optionalOnlyFolderSlots = folderAccessSlots.filter((folder) => !folder.defaultSourcePath)
	const services = app.storage?.services ?? []
	const serviceImages = app.storage?.serviceImages ?? {}
	const occupiedTargets = app.storage?.occupiedTargets ?? []
	const [newServiceName, setNewServiceName] = useState(services[0] ?? '')
	const [newTargetPath, setNewTargetPath] = useState('')
	const [newReadOnly, setNewReadOnly] = useState(false)
	const [newSourcePath, setNewSourcePath] = useState<string | null>(null)
	const dataRoot = app.storage?.dataRoot
	const moveDataRootMut = trpcReact.apps.moveDataRoot.useMutation({
		onSettled: () => {
			utils.apps.list.invalidate()
			utils.apps.state.invalidate({appId: app.id})
		},
		onError: (error) => {
			toast.error(t('app-settings.storage.move-error', {message: stripErrorCode(error.message)}))
		},
	})
	const resetDataRootMut = trpcReact.apps.resetDataRoot.useMutation({
		onSettled: () => {
			utils.apps.list.invalidate()
			utils.apps.state.invalidate({appId: app.id})
		},
		onError: (error) => {
			toast.error(t('app-settings.storage.reset-error', {message: stripErrorCode(error.message)}))
		},
	})
	const dataRootOperationInProgress =
		operations.some((operation) => operation.appId === app.id) ||
		moveDataRootMut.isPending ||
		resetDataRootMut.isPending

	const backupRepositoriesQ = trpcReact.backups.getRepositories.useQuery()
	const hasBackupRepositories = (backupRepositoriesQ.data?.length ?? 0) > 0

	// Fetch while choosing as well as confirming so non-ext4 drives fail closed
	// in the picker and cannot begin an app-data move.
	const externalDevicesQ = trpcReact.files.externalDevices.useQuery(undefined, {
		enabled: activePicker?.type === 'data-root' || !!pendingDataRootParentPath?.startsWith(`${EXTERNAL_STORAGE_PATH}/`),
	})
	const pendingDataRootDestinationPath = pendingDataRootParentPath
		? getDataRootDestinationPath(pendingDataRootParentPath, app.id)
		: null
	const pendingMoveWarningKind = getDataRootMoveWarning(pendingDataRootParentPath, externalDevicesQ.data)
	// Where the app is headed, for the diagram: null while the dialog is closed
	const pendingMoveDestination =
		pendingDataRootParentPath === undefined
			? null
			: pendingDataRootParentPath === null
				? ('internal' as const)
				: ('removable' as const)
	// The destination's risk in one plain sentence, and — only when backups are
	// actually configured — what leaving internal storage costs
	const pendingMoveWarningText =
		pendingMoveWarningKind === 'unsupported-filesystem'
			? t('app-settings.storage.ext4-required-description')
			: pendingMoveWarningKind === 'removable'
				? t('app-settings.storage.confirm-move-removable-warning', {app: app.name})
				: null
	const showPendingMoveBackupNote = hasBackupRepositories && Boolean(pendingDataRootParentPath)
	const pendingMoveTitle = pendingDataRootParentPath
		? t('app-settings.storage.confirm-move-removable-title', {app: app.name})
		: t('app-settings.storage.confirm-move-internal-title', {app: app.name})
	const selectedServiceName = services.includes(newServiceName) ? newServiceName : (services[0] ?? '')
	const connectedFolderAccessCount = optionalOnlyFolderSlots.filter((folder) =>
		getFolderAccessSelection(folderAccess, folder),
	).length
	const folderAccessSummary = [
		requiredFolderSlots.length
			? t('app-settings.storage.required-folders-count', {count: requiredFolderSlots.length})
			: null,
		connectedFolderAccessCount
			? t('app-settings.storage.optional-folders-connected', {count: connectedFolderAccessCount})
			: null,
		customMounts.length ? t('app-settings.storage.custom-folders-count', {count: customMounts.length}) : null,
	].filter((summary): summary is string => Boolean(summary))
	const folderAccessDescription =
		folderAccessSummary.length > 0
			? folderAccessSummary.join(' · ')
			: t('app-settings.storage.more-folders-description')
	const newMountTargetPath = normalizeContainerPathInput(newTargetPath)
	const newMountKey = selectedServiceName ? `${selectedServiceName}:${newMountTargetPath}` : ''
	const configuredMountKeys = getCustomMountConflictKeys(folderAccessSlots, folderAccess, customMounts)
	const occupiedMountKeys = new Set(occupiedTargets.map((mount) => `${mount.serviceName}:${mount.targetPath}`))
	const hasNewTargetPath = newTargetPath.trim().length > 0
	const newTargetPathIsValid = isContainerPathInputValid(newTargetPath)
	const newTargetPathIsDuplicate = Boolean(
		selectedServiceName && newTargetPathIsValid && configuredMountKeys.has(newMountKey),
	)
	const newTargetPathReplacesDefault = Boolean(
		selectedServiceName && newTargetPathIsValid && occupiedMountKeys.has(newMountKey),
	)
	const canAddMount = Boolean(selectedServiceName && newTargetPathIsValid && !newTargetPathIsDuplicate)
	const activePickerSourcePath =
		activePicker?.type === 'data-root'
			? dataRoot?.location
				? getDataRootParentPath(dataRoot.location)
				: undefined
			: activePicker?.type === 'custom-mount'
				? activePicker.mount.sourcePath
				: activePicker?.type === 'folder-access'
					? getFolderAccessSource(folderAccess, activePicker.folder)
					: (newSourcePath ?? undefined)
	const activePickerIsDataRoot = activePicker?.type === 'data-root'
	const activePickerOpenPath = getStorageBrowserOpenPath(
		activePickerSourcePath,
		activePickerIsDataRoot ? EXTERNAL_STORAGE_PATH : HOME_PATH,
	)
	const managedDataRootPaths = userApps.flatMap((userApp) => getManagedDataRootPath(userApp) ?? [])
	const activePickerSelectableFilter = (entry: {path: string}) => {
		if (activePickerIsDataRoot) {
			if (!isDataRootParentSelectable(entry)) return false
			if (!isExt4AppDataRootPath(entry.path, externalDevicesQ.data)) return false
			const destinationPath = getDataRootDestinationPath(entry.path, app.id)
			return !managedDataRootPaths.some((dataRootPath) => storagePathsOverlap(destinationPath, dataRootPath))
		}

		return (
			isFolderAccessSourceSelectable(entry) &&
			!managedDataRootPaths.some((dataRootPath) => storagePathsOverlap(entry.path, dataRootPath))
		)
	}
	const shouldPreselectActivePickerPath = Boolean(
		activePickerSourcePath &&
		!missingSourcePaths.has(activePickerSourcePath) &&
		isStorageBrowserPath(activePickerSourcePath) &&
		activePickerSelectableFilter({path: activePickerSourcePath}),
	)
	const activePickerTitle =
		activePicker?.type === 'data-root'
			? t('app-settings.storage.choose-app-storage-title')
			: activePicker?.type === 'custom-mount'
				? t('app-settings.storage.choose-location-title', {
						folder: getMountName(activePicker.mount) ?? t('app-settings.storage.app-folder'),
					})
				: activePicker?.type === 'folder-access'
					? t('app-settings.storage.choose-optional-folder-title', {folder: activePicker.folder.name})
					: activePicker?.type === 'add'
						? t('app-settings.storage.choose-folder-to-share-title')
						: t('app-settings.storage.choose-folder-title')
	const activePickerSubtitle =
		activePicker?.type === 'data-root'
			? t('app-settings.storage.ext4-required-description')
			: activePicker?.type === 'add'
				? t('app-settings.storage.choose-folder-to-share-description')
				: activePickerSourcePath
					? t('app-settings.storage.current-folder', {path: activePickerSourcePath})
					: undefined

	const removeCustomMount = (mountToRemove: AppCustomMount) => {
		setCustomMounts((currentMounts) =>
			currentMounts.filter(
				(mount) => mount.serviceName !== mountToRemove.serviceName || mount.targetPath !== mountToRemove.targetPath,
			),
		)
	}

	const setCustomMountSource = (mountToUpdate: AppCustomMount, sourcePath: string) => {
		setCustomMounts((currentMounts) =>
			currentMounts.map((mount) =>
				mount.serviceName === mountToUpdate.serviceName && mount.targetPath === mountToUpdate.targetPath
					? {...mount, sourcePath}
					: mount,
			),
		)
	}

	const setCustomMountReadOnly = (mountToUpdate: AppCustomMount, readOnly: boolean) => {
		setCustomMounts((currentMounts) =>
			currentMounts.map((mount) =>
				mount.serviceName === mountToUpdate.serviceName && mount.targetPath === mountToUpdate.targetPath
					? {...mount, readOnly}
					: mount,
			),
		)
	}

	const setFolderAccessSource = (folder: AppFolderAccessSlot, sourcePath: string) => {
		const mountKeys = new Set(getFolderAccessMountKeys(folder))
		setCustomMounts((currentMounts) => currentMounts.filter((mount) => !mountKeys.has(getStorageMountKey(mount))))
		setFolderAccess((currentFolders) => [
			...currentFolders.filter((currentFolder) => currentFolder.id !== folder.id),
			{id: folder.id, sourcePath},
		])
	}

	const removeFolderAccessSource = (folder: AppFolderAccessSlot) => {
		setFolderAccess((currentFolders) => currentFolders.filter((currentFolder) => currentFolder.id !== folder.id))
	}

	const addCustomMount = (sourcePath: string) => {
		if (!selectedServiceName || !isContainerPathInputValid(newTargetPath)) return

		const mount: AppCustomMount = {
			serviceName: selectedServiceName,
			targetPath: newMountTargetPath,
			sourcePath,
			readOnly: newReadOnly,
		}

		setCustomMounts((currentMounts) => [...currentMounts, mount])
		setNewTargetPath('')
		setNewReadOnly(false)
		setNewSourcePath(null)
	}

	const dataRootControl = dataRoot ? (
		dataRootOperationInProgress ? (
			<Button size='input-short' disabled>
				{resetDataRootMut.isPending ? t('app-settings.storage.starting-fresh') : t('app-settings.storage.moving')}
			</Button>
		) : dataRoot.status === 'storage-unavailable' || dataRoot.status === 'data-missing' ? (
			<Button size='input-short' variant='destructive' onClick={() => setResetDataRootOpen(true)}>
				{t('app-settings.storage.start-fresh')}
			</Button>
		) : dataRoot.status === 'checking' ? (
			<Button size='input-short' disabled>
				{t('app-settings.storage.checking')}
			</Button>
		) : dataRoot.location && !dataRoot.canMoveExternally ? (
			<Button size='input-short' onClick={() => setPendingDataRootParentPath(null)}>
				{t('app-settings.storage.move-to-internal')}
			</Button>
		) : dataRoot.location ? (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size='input-short'>
						{t('app-settings.storage.move')}
						<ChevronDown className='size-3.5 text-white/45' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='p-1'>
					<DropdownMenuItem onSelect={() => setActivePicker({type: 'data-root'})}>
						{t('app-settings.storage.choose-another-location')}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setPendingDataRootParentPath(null)}>
						{t('app-settings.storage.move-to-internal')}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		) : (
			<Button size='input-short' onClick={() => setActivePicker({type: 'data-root'})}>
				{t('app-settings.storage.move')}
			</Button>
		)
	) : undefined
	const dataRootDescription = (() => {
		if (!dataRoot) return t('app-settings.storage.app-storage-unsupported')
		if (dataRoot.status === 'checking') return t('app-settings.storage.checking-description')
		if (dataRoot.status === 'storage-unavailable') return t('app-settings.storage.app-storage-unavailable')
		if (dataRoot.status === 'data-missing') {
			return t('app-settings.storage.app-data-missing', {path: dataRoot.location})
		}
		if (dataRoot.location) return <StorageLocation path={dataRoot.location} />
		return t('app-settings.storage.internal-storage')
	})()
	const renderFolderAccessSection = (title: string, description: string, folderSlots: AppFolderAccessSlot[]) => {
		if (folderSlots.length === 0) return null

		return (
			<div className='space-y-2'>
				<div className='space-y-1'>
					<h3 className='text-13 font-medium text-white/90'>{title}</h3>
					<p className='text-12 leading-tight text-white/40'>{description}</p>
				</div>
				<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/5'>
					{folderSlots.map((folder) => {
						const selection = getFolderAccessSelection(folderAccess, folder)
						const sourcePath = getFolderAccessSource(folderAccess, folder)
						const appsUsingFolder = sourcePath ? getAppsUsingSourcePath(userApps, app.id, sourcePath) : []
						const allMountsReadOnly = folder.mounts.every((mount) => mount.readOnly)
						const isDefaultBacked = Boolean(folder.defaultSourcePath)

						return (
							<div key={folder.id} className='space-y-3 p-3'>
								<div className='flex items-start justify-between gap-3'>
									<div className='min-w-0 space-y-1'>
										<div className='flex min-w-0 items-center gap-2'>
											<span className='min-w-0 truncate text-14 font-medium text-white/90'>{folder.name}</span>
											<FolderAccessPill appName={app.name} readOnly={allMountsReadOnly} />
										</div>
										<div className='text-12 leading-tight text-white/40'>
											{folder.note ?? t('app-settings.storage.inferred-folder-note', {app: app.name})}
										</div>
									</div>
									{selection ? (
										<button
											type='button'
											onClick={() => removeFolderAccessSource(folder)}
											className='shrink-0 rounded-full px-2 py-1 text-12 font-medium text-white/45 transition-colors hover:bg-white/5 hover:text-white/70'
										>
											{isDefaultBacked ? t('app-settings.storage.use-default') : t('app-settings.storage.disconnect')}
										</button>
									) : null}
								</div>

								<StoragePathPicker
									path={sourcePath}
									actionLabel={sourcePath ? t('change') : t('connect')}
									onBrowse={() => setActivePicker({type: 'folder-access', folder})}
								/>
								{sourcePath ? <StorageMissingSourceHint missing={missingSourcePaths.has(sourcePath)} /> : null}
								{sourcePath ? <StorageSharedFolderHint apps={appsUsingFolder} /> : null}
								{sourcePath ? (
									<StorageNotBackedUpHint show={isRemovableSourcePath(sourcePath) && hasBackupRepositories} />
								) : null}
								<StorageTechnicalDetails
									mounts={folder.mounts.map((mount) => ({
										serviceName: mount.serviceName,
										path: mount.targetPath,
										image: serviceImages[mount.serviceName],
									}))}
								/>
							</div>
						)
					})}
				</div>
			</div>
		)
	}

	return (
		<div className='flex flex-col gap-y-5'>
			<SettingsViewTransition
				viewKey={storageSubView}
				depth={storageSubView === 'storage' ? 0 : storageSubView === 'folderAccess' ? 1 : 2}
			>
				{storageSubView === 'storage' ? (
					<>
						<BackButton onClick={onBack}>{t('app-settings.title')}</BackButton>

						<SettingsViewHeader
							title={t('app-settings.storage.title')}
							description={t('app-settings.storage.page-description')}
						/>

						<SettingsControlRow
							title={t('app-settings.storage.app-folders')}
							description={dataRootDescription}
							control={dataRootControl}
							icon={TbDatabase}
							tone={1}
						/>

						<SettingsNavigationRow
							title={t('app-settings.storage.more-folders')}
							description={folderAccessDescription}
							onClick={() => setStorageSubView('folderAccess')}
							icon={TbFolders}
							tone={2}
						/>
					</>
				) : storageSubView === 'folderAccess' ? (
					<>
						<BackButton onClick={() => setStorageSubView('storage')}>{t('app-settings.storage.title')}</BackButton>

						<SettingsViewHeader
							title={t('app-settings.storage.more-folders')}
							description={t('app-settings.storage.more-folders-page-description')}
						/>

						<StorageUnavailableSummary items={folderAccessMissingSourcePaths} />

						{renderFolderAccessSection(
							t('app-settings.storage.required-folders'),
							t('app-settings.storage.required-folders-description'),
							requiredFolderSlots,
						)}

						{renderFolderAccessSection(
							t('app-settings.storage.optional-folders'),
							t('app-settings.storage.optional-folders-description'),
							optionalOnlyFolderSlots,
						)}

						<SettingsNavigationRow
							title={t('app-settings.storage.custom-folders')}
							description={
								customMounts.length
									? t('app-settings.storage.custom-folders-count', {count: customMounts.length})
									: t('app-settings.storage.custom-folders-summary')
							}
							onClick={() => setStorageSubView('advancedFolderAccess')}
							icon={TbSettings}
							tone={3}
						/>
					</>
				) : (
					<>
						<BackButton onClick={() => setStorageSubView('folderAccess')}>
							{t('app-settings.storage.more-folders')}
						</BackButton>

						<SettingsViewHeader
							title={t('app-settings.storage.advanced-folder-access')}
							description={t('app-settings.storage.custom-folders-description')}
						/>

						<StorageUnavailableSummary items={customMountMissingSourcePaths} />

						<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/5'>
							{customMounts.map((mount) => (
								<div key={getStorageMountKey(mount)} className='space-y-3 p-3'>
									<div className='flex items-start justify-between gap-3'>
										<div className='min-w-0 space-y-1'>
											<div className='flex min-w-0 items-center gap-2'>
												<span className='min-w-0 truncate text-14 font-medium text-white/90'>
													{getMountName(mount) ?? t('app-settings.storage.app-folder')}
												</span>
												<StoragePermissionControl
													readOnly={mount.readOnly}
													onChange={(readOnly) => setCustomMountReadOnly(mount, readOnly)}
												/>
												{occupiedMountKeys.has(getStorageMountKey(mount)) ? (
													<SettingsPill>{t('app-settings.storage.overrides-default')}</SettingsPill>
												) : null}
											</div>
											<div className='truncate text-12 leading-tight text-white/40' title={mount.targetPath}>
												{t('app-settings.storage.path-inside-app')}: <span dir='ltr'>{mount.targetPath}</span>
											</div>
										</div>
										<SettingsIconButton
											label={
												occupiedMountKeys.has(getStorageMountKey(mount))
													? t('app-settings.storage.reset-to-default')
													: t('app-settings.storage.remove')
											}
											onClick={() => removeCustomMount(mount)}
										>
											<Trash2 className='size-3.5' />
										</SettingsIconButton>
									</div>

									<StoragePathPicker
										path={mount.sourcePath}
										onBrowse={() => setActivePicker({type: 'custom-mount', mount})}
									/>
									<StorageMissingSourceHint missing={missingSourcePaths.has(mount.sourcePath)} />
									<StorageNotBackedUpHint show={isRemovableSourcePath(mount.sourcePath) && hasBackupRepositories} />
									<StorageTechnicalDetails
										mounts={[
											{
												serviceName: mount.serviceName,
												path: mount.targetPath,
												image: serviceImages[mount.serviceName],
											},
										]}
									/>
								</div>
							))}

							{customFolderFormOpen ? (
								<SettingsAddForm
									title={t('app-settings.storage.new-custom-folder')}
									onCancel={() => {
										setCustomFolderFormOpen(false)
										setNewTargetPath('')
										setNewReadOnly(false)
										setNewSourcePath(null)
									}}
									submit={
										<Button
											variant='primary'
											size='sm'
											disabled={!canAddMount || !newSourcePath}
											onClick={() => {
												if (!newSourcePath) return
												addCustomMount(newSourcePath)
												setCustomFolderFormOpen(false)
											}}
										>
											{newTargetPathReplacesDefault
												? t('app-settings.storage.replace-folder')
												: t('app-settings.storage.add-folder')}
										</Button>
									}
								>
									{services.length > 1 ? (
										<div>
											<div className='mb-1.5 px-[5px] text-12 -tracking-2 text-white/50'>
												{t('app-settings.storage.app-service')}
											</div>
											<AppServiceSelect
												services={services}
												serviceImages={serviceImages}
												value={selectedServiceName}
												onChange={setNewServiceName}
											/>
										</div>
									) : null}

									<Labeled label={t('app-settings.storage.path-inside-app')}>
										<Input
											sizeVariant='short-square'
											value={newTargetPath}
											onValueChange={setNewTargetPath}
											placeholder={t('app-settings.storage.container-path-placeholder')}
										/>
										{hasNewTargetPath && !newTargetPathIsValid ? (
											<SettingsInputHint tone='warning'>
												{t('app-settings.storage.invalid-container-path')}
											</SettingsInputHint>
										) : newTargetPathIsDuplicate ? (
											<SettingsInputHint tone='warning'>
												{t('app-settings.storage.duplicate-container-path')}
											</SettingsInputHint>
										) : newTargetPathReplacesDefault ? (
											<SettingsInputHint tone='warning'>
												{t('app-settings.storage.replaces-default-path')}
											</SettingsInputHint>
										) : (
											<SettingsInputHint>{t('app-settings.storage.path-inside-app-help')}</SettingsInputHint>
										)}
									</Labeled>

									<div>
										{/* The Labeled header row, with the compact read-only toggle
										    (as on the user account share-all rows) right-aligned in it */}
										<div className='mb-1.5 flex items-center justify-between gap-2 px-[5px]'>
											<span className='text-12 -tracking-2 text-white/50'>{t('app-settings.storage.folder')}</span>
											<div className='flex items-center gap-1.5'>
												<span className='text-12 -tracking-2 text-white/50'>{t('app-settings.storage.read-only')}</span>
												{/* The info tooltip explains the currently selected mode, as
												    on the install review's folder badges */}
												<DarkTooltip
													label={
														newReadOnly
															? t('app-settings.storage.read-only-tooltip', {app: app.name})
															: t('app-settings.storage.read-write-tooltip', {app: app.name})
													}
													className='max-w-64 rounded-12 px-3 py-1.5 text-left whitespace-normal'
												>
													<button
														type='button'
														aria-label={
															newReadOnly
																? t('app-settings.storage.read-only-tooltip', {app: app.name})
																: t('app-settings.storage.read-write-tooltip', {app: app.name})
														}
														className='rounded-full text-white/30 transition-colors hover:text-white/60 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/20'
													>
														<TbInfoCircle className='size-3.5' />
													</button>
												</DarkTooltip>
												<Switch
													className='-my-0.5 scale-75'
													checked={newReadOnly}
													onCheckedChange={(checked) => setNewReadOnly(checked === true)}
												/>
											</div>
										</div>
										<StoragePathPicker
											path={newSourcePath ?? undefined}
											onBrowse={() => setActivePicker({type: 'add'})}
										/>
									</div>
								</SettingsAddForm>
							) : (
								<SettingsAddRowButton
									label={t('app-settings.storage.add-custom-folder')}
									onClick={() => setCustomFolderFormOpen(true)}
								/>
							)}
						</div>
					</>
				)}
			</SettingsViewTransition>

			<MiniBrowser
				open={Boolean(activePicker)}
				onOpenChange={(open) => {
					if (!open) setActivePicker(null)
				}}
				rootPath={activePickerIsDataRoot ? EXTERNAL_STORAGE_PATH : HOME_PATH}
				rootPaths={
					activePickerIsDataRoot ? [EXTERNAL_STORAGE_PATH] : [HOME_PATH, EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH]
				}
				onOpenPath={activePickerOpenPath}
				preselectOnOpen={shouldPreselectActivePickerPath}
				title={activePickerTitle}
				subtitle={activePickerSubtitle}
				selectionMode='folders'
				selectableFilter={activePickerSelectableFilter}
				allowNewFolderCreation
				selectButtonLabel={
					activePicker?.type === 'data-root'
						? t('app-settings.storage.choose-location')
						: t('app-settings.storage.use-folder')
				}
				onSelect={(sourcePath) => {
					if (!activePicker) return

					if (activePicker.type === 'data-root') {
						setPendingDataRootParentPath(sourcePath)
					} else if (activePicker.type === 'custom-mount') {
						setCustomMountSource(activePicker.mount, sourcePath)
					} else if (activePicker.type === 'folder-access') {
						setFolderAccessSource(activePicker.folder, sourcePath)
					} else {
						setNewSourcePath(sourcePath)
					}
					setActivePicker(null)
				}}
			/>

			<AlertDialog
				open={pendingDataRootParentPath !== undefined}
				onOpenChange={(open) => {
					if (!open) setPendingDataRootParentPath(undefined)
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						{/* App → destination, following the Files cloud diagrams */}
						{pendingMoveDestination ? <AppMoveDiagram appIcon={app.icon} destination={pendingMoveDestination} /> : null}
						<AlertDialogTitle>{pendingMoveTitle}</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className='space-y-3 pt-1'>
								<div className='rounded-12 bg-white/5 px-3.5 py-2.5 text-left'>
									{pendingDataRootDestinationPath ? (
										<PathBreadcrumbs path={pendingDataRootDestinationPath} className='text-13 text-white/85' />
									) : (
										<span className='text-13 font-medium text-white/85'>
											{t('app-settings.storage.move-to-internal-storage')}
										</span>
									)}
								</div>
								{pendingMoveWarningText ? (
									<p className='text-13 leading-snug text-white/60'>{pendingMoveWarningText}</p>
								) : null}
								{showPendingMoveBackupNote ? (
									<p className='text-12 leading-snug text-white/40'>
										{t('app-settings.storage.confirm-move-backup-warning', {app: app.name})}
									</p>
								) : null}
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='primary'
							disabled={pendingMoveWarningKind === 'unsupported-filesystem'}
							onClick={() => {
								if (pendingMoveWarningKind === 'unsupported-filesystem') return
								moveDataRootMut.mutate({
									appId: app.id,
									destinationParentPath: pendingDataRootParentPath ?? null,
								})
								setPendingDataRootParentPath(undefined)
							}}
						>
							{t('app-settings.storage.move')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={resetDataRootOpen} onOpenChange={setResetDataRootOpen}>
				<AlertDialogContent>
					<AlertDialogHeader icon={TbAlertTriangle}>
						<AlertDialogTitle>{t('app-settings.storage.confirm-reset-title', {app: app.name})}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('app-settings.storage.confirm-reset-description', {location: dataRoot?.location ?? ''})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='destructive'
							onClick={() => {
								resetDataRootMut.mutate({appId: app.id})
								setResetDataRootOpen(false)
							}}
						>
							{t('app-settings.storage.start-fresh')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}

// The app flowing toward its new storage location, following the Files cloud
// diagrams (see CloudBreakDiagram): app icon, a faint connection line, and the
// destination device. Rendered inside AlertDialogDescription-adjacent header
// content, so it uses only phrasing-content elements.
function AppMoveDiagram({appIcon, destination}: {appIcon?: string; destination: 'internal' | 'removable' | 'network'}) {
	// Internal storage is the Umbrel itself, drawn with the same mark the cloud
	// diagrams use for the umbrelOS side
	const destinationIcon =
		destination === 'internal'
			? '/assets/umbrel-ios.png'
			: destination === 'network'
				? activeNasIcon
				: externalStorageIcon

	return (
		<span className='mb-4 flex items-center justify-center gap-2.5'>
			<AppIcon src={appIcon} size={44} className='shrink-0 rounded-10' />
			<span className='relative flex h-8 w-14 items-center'>
				<span className='h-px w-full bg-linear-to-r from-white/5 via-white/25 to-white/5' />
				<ChevronRight className='absolute -right-1 size-3 text-white/30' />
			</span>
			<img
				src={destinationIcon}
				alt=''
				className={cn('size-11 shrink-0 object-contain', destination === 'internal' && 'rounded-xl')}
				draggable={false}
			/>
		</span>
	)
}

function StoragePathPicker({path, actionLabel, onBrowse}: {path?: string; actionLabel?: string; onBrowse: () => void}) {
	const {t} = useTranslation()

	return (
		<FolderPickerRow
			path={path}
			emptyLabel={t('app-settings.storage.no-folder-selected')}
			actionLabel={actionLabel}
			onAction={onBrowse}
		/>
	)
}

function StorageUnavailableSummary({items}: {items: string[]}) {
	const {t} = useTranslation()
	if (items.length === 0) return null

	return (
		<div className='flex items-start gap-2 rounded-10 bg-yellow-500/10 p-3 text-left'>
			<TbAlertTriangle className='mt-0.5 size-4 shrink-0 text-yellow-400/80' />
			<div className='min-w-0 flex-1'>
				<div className='text-12 leading-tight text-white/65'>
					{t('app-settings.storage.source-unavailable-title', {count: items.length})}{' '}
					{t('app-settings.storage.source-unavailable-check-folder', {count: items.length})}
				</div>
				<div className='space-y-1'>
					{items.map((sourcePath) => (
						<div
							key={sourcePath}
							className='mt-1 truncate text-12 leading-tight font-medium text-white/75'
							title={sourcePath}
							dir='ltr'
						>
							{sourcePath}
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

function StorageMissingSourceHint({missing}: {missing: boolean}) {
	const {t} = useTranslation()
	if (!missing) return null

	return (
		<div className='flex items-start gap-2 rounded-8 border border-yellow-300/20 bg-yellow-500/8 px-2.5 py-2 text-left'>
			<TbAlertTriangle className='mt-px size-3.5 shrink-0 text-yellow-200/80' />
			<div className='min-w-0 text-11 leading-tight text-yellow-200/70'>
				{t('app-settings.storage.source-unavailable-row')}
			</div>
		</div>
	)
}

function StorageNotBackedUpHint({show}: {show: boolean}) {
	const {t} = useTranslation()
	if (!show) return null

	return (
		<div className='flex items-center gap-1 px-1 text-left'>
			<TbInfoCircle className='size-3.5 shrink-0 text-white/30' />
			<div className='min-w-0 text-11 leading-tight text-white/40'>{t('app-settings.storage.not-backed-up-row')}</div>
		</div>
	)
}

function StorageTechnicalDetails({
	mounts,
}: {
	mounts: Array<{serviceName: string; path: string; image?: string | null}>
}) {
	const {t} = useTranslation()
	const [open, setOpen] = useState(false)

	return (
		<div className='space-y-1 px-0.5'>
			<button
				type='button'
				onClick={() => setOpen((currentOpen) => !currentOpen)}
				className='flex items-center gap-1 text-11 font-medium text-white/35 transition-colors hover:text-white/55'
			>
				{t('app-settings.storage.technical-details')}
				<ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
			</button>

			{open ? (
				<div className='divide-y divide-white/6 rounded-8 bg-white/4 px-2.5'>
					{mounts.map((mount) => (
						<div key={`${mount.serviceName}:${mount.path}`} className='space-y-1.5 py-2'>
							<StorageTechnicalDetail label={t('app-settings.storage.umbrel-service')} value={mount.serviceName} />
							<StorageTechnicalDetail label={t('app-settings.storage.path-inside-app')} value={mount.path} />
							{mount.image ? (
								<StorageTechnicalDetail
									// The digest is noise at a glance — the readable name and tag
									// carry the identity, and the full reference stays hoverable
									label={t('app-settings.storage.container-image')}
									value={mount.image.split('@')[0]}
									title={mount.image}
								/>
							) : null}
						</div>
					))}
				</div>
			) : null}
		</div>
	)
}

// Label left, value right, like the backup location detail rows. Long values
// scroll horizontally in place instead of truncating away the interesting end.
function StorageTechnicalDetail({label, value, title}: {label: string; value: string; title?: string}) {
	return (
		<div className='flex min-w-0 items-baseline justify-between gap-3 text-11'>
			<span className='shrink-0 text-white/35'>{label}</span>
			<span
				dir='ltr'
				className='umbrel-hide-scrollbar min-w-0 overflow-x-auto text-right font-mono whitespace-nowrap text-white/55'
				title={title ?? value}
			>
				{value}
			</span>
		</div>
	)
}

function StoragePermissionControl({readOnly, onChange}: {readOnly: boolean; onChange: (readOnly: boolean) => void}) {
	const {t} = useTranslation()
	const value = readOnly ? 'read-only' : 'read-write'

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					className={cn(settingsPillClass, 'gap-0.5 transition-colors hover:bg-white/[0.12] hover:text-white/65')}
				>
					{readOnly ? t('app-settings.storage.read-only') : t('app-settings.storage.read-write')}
					<ChevronDown className='size-3' />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start'>
				<DropdownMenuCheckboxItem checked={value === 'read-write'} onSelect={() => onChange(false)}>
					{t('app-settings.storage.read-write')}
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem checked={value === 'read-only'} onSelect={() => onChange(true)}>
					{t('app-settings.storage.read-only')}
				</DropdownMenuCheckboxItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
