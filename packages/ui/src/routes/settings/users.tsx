import {Loader2, PlusCircle} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {lazy, Suspense, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbCheck, TbCopy, TbInfoCircle, TbTrash} from 'react-icons/tb'
import {useSearchParams} from 'react-router-dom'
import {useCopyToClipboard} from 'react-use'

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
import {AnimatedHeight} from '@/components/ui/animated-height'
import {Button} from '@/components/ui/button'
import {Dialog, DialogDescription, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {IconButton} from '@/components/ui/icon-button'
import {Input, PasswordInput} from '@/components/ui/input'
import {listClass} from '@/components/ui/list'
import {SearchablePicker} from '@/components/ui/searchable-picker'
import {Separator} from '@/components/ui/separator'
import {toast} from '@/components/ui/toast'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useHomeDirectoryName} from '@/features/files/hooks/use-home-directory-name'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useAppMemberShares} from '@/hooks/use-app-member-shares'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {AccountAvatar} from '@/modules/auth/account-avatar'
import {AccountAvatarEditor} from '@/modules/auth/account-avatar-editor'
import {OWNER_USER_ID} from '@/modules/auth/constants'
import {useAccountAvatar} from '@/modules/auth/use-account-avatar'
import {
	AnimatedRow,
	EmptyCard,
	GrantSummary,
	RowChevron,
	RowRemoveButton,
	ShareAllToggle,
	ShareEveryoneRow,
	shareListClass,
} from '@/modules/user-sharing'
import {
	getNewUserAccessDefaults,
	isCoveredByHomeShare,
	isStorageCategoryPath,
	planNewUserAccessChanges,
	removeUserFromSharedWith,
} from '@/modules/user-sharing/new-user-access'
import type {SharedWith} from '@/modules/user-sharing/new-user-access'
import {OwnerAccountPanel, type OwnerPanel} from '@/routes/settings/_components/owner-account-panel'
import {BackButton, SectionLabel, useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {ManagedSessionsPanel} from '@/routes/settings/sessions'
import {RouterOutput, trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

const MiniBrowser = lazy(() =>
	import('@/features/files/components/mini-browser').then((module) => ({default: module.MiniBrowser})),
)

type FolderShare = RouterOutput['files']['memberShares'][number]
type AppShare = RouterOutput['apps']['memberShares'][number]
type NewUserInheritedAccess = {
	appIds: string[]
	folderPaths: string[]
}
type LocalView =
	| {view: 'list'}
	| {view: 'add'; inheritedAccess: NewUserInheritedAccess}
	| {view: 'edit'; userId: string}
	| {view: 'created'; userId: string; name: string; password: string; avatarUrl?: string}
type View = LocalView | {view: 'owner'; panel: OwnerPanel}

const ownerPanels = new Set<OwnerPanel>(['overview', 'name', 'password', 'sessions'])
const MIN_PASSWORD_LENGTH = 6

function isOwnerPanel(value: string | null): value is OwnerPanel {
	return value !== null && ownerPanels.has(value as OwnerPanel)
}

function shareCoversUser(sharedWith: SharedWith, userId: string) {
	return sharedWith === 'all' || sharedWith.includes(userId)
}

function addUserToSharedWith(sharedWith: SharedWith, userId: string): SharedWith {
	if (sharedWith === 'all' || sharedWith.includes(userId)) return sharedWith
	return [...sharedWith, userId]
}

// Share hooks already toast mutation errors. Settling them here lets the other
// independent share changes continue and avoids misreporting them as account-creation failures.
function settleToastedShareMutation(mutation: Promise<unknown>) {
	return mutation.catch(() => undefined)
}

// Keeps the whole-record sharing mutations and their safety guards in one
// place. The dialog only needs per-user add/remove operations.
function useUserShares(memberIds: string[], enabled: boolean) {
	const folders = useMemberShares({enabled})
	const apps = useAppMemberShares({enabled})
	const folderShares = folders.memberShares ?? []
	const appShares = apps.appMemberShares ?? []
	const sharesReady = folders.memberShares !== undefined && apps.appMemberShares !== undefined
	const shareControlsDisabled =
		!sharesReady ||
		folders.isAddingMemberShare ||
		folders.isRemovingMemberShare ||
		apps.isAddingAppMemberShare ||
		apps.isRemovingAppMemberShare

	// The hooks toast write failures. These endpoints replace whole records, so
	// every operation starts from the loaded lists and keeps other members' access intact.
	const updateAppForUser = async (appId: string, userId: string, shouldShare: boolean, knownMemberIds = memberIds) => {
		const existingShare = appShares.find((share) => share.appId === appId)
		if (!existingShare && !shouldShare) return
		const nextSharedWith = shouldShare
			? addUserToSharedWith(existingShare?.sharedWith ?? [], userId)
			: removeUserFromSharedWith(existingShare?.sharedWith ?? [], userId, knownMemberIds)
		if (existingShare && nextSharedWith === existingShare.sharedWith) return
		if (nextSharedWith === 'all') return
		if (nextSharedWith.length === 0) await settleToastedShareMutation(apps.removeAppMemberShare({appId}))
		else await settleToastedShareMutation(apps.addAppMemberShare({appId, sharedWith: nextSharedWith}))
	}

	const updateFolderForUser = async (
		path: string,
		userId: string,
		shouldShare: boolean,
		knownMemberIds = memberIds,
	) => {
		const existingShare = folderShares.find((share) => share.path === path)
		if (!existingShare && !shouldShare) return
		const nextSharedWith = shouldShare
			? addUserToSharedWith(existingShare?.sharedWith ?? [], userId)
			: removeUserFromSharedWith(existingShare?.sharedWith ?? [], userId, knownMemberIds)
		if (existingShare && nextSharedWith === existingShare.sharedWith) return
		if (nextSharedWith === 'all') return
		if (nextSharedWith.length === 0) await settleToastedShareMutation(folders.removeMemberShare({path}))
		else await settleToastedShareMutation(folders.addMemberShare({path, sharedWith: nextSharedWith}))
	}

	return {
		folderShares,
		appShares,
		sharesReady,
		shareControlsDisabled,
		isError: folders.isErrorMemberShares || apps.isErrorAppMemberShares,
		addAppForUser: (appId: string, userId: string) => updateAppForUser(appId, userId, true),
		addFolderForUser: (path: string, userId: string) => updateFolderForUser(path, userId, true),
		removeAppForUser: (appId: string, userId: string, knownMemberIds?: string[]) =>
			updateAppForUser(appId, userId, false, knownMemberIds),
		removeFolderForUser: (path: string, userId: string, knownMemberIds?: string[]) =>
			updateFolderForUser(path, userId, false, knownMemberIds),
	}
}

export default function UsersDialog() {
	const {t} = useTranslation()
	const dialogProps = useSettingsDialogProps()
	const utils = trpcReact.useUtils()
	const homeDirectoryName = useHomeDirectoryName()
	const isMobile = useIsMobile()
	const [searchParams, setSearchParams] = useSearchParams()
	const [localView, setLocalView] = useState<LocalView>({view: 'list'})
	const ownerPanel = searchParams.get('ownerPanel')
	const view: View = isOwnerPanel(ownerPanel) ? {view: 'owner', panel: ownerPanel} : localView
	const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false)
	const [name, setName] = useState('')
	const [password, setPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')
	const [avatarFile, setAvatarFile] = useState<File>()
	const [pickedAppIds, setPickedAppIds] = useState<string[]>([])
	const [pickedFolders, setPickedFolders] = useState<string[]>([])
	const [shareAllApps, setShareAllApps] = useState(false)
	const [shareAllFolders, setShareAllFolders] = useState(false)
	const [allowExternalStorage, setAllowExternalStorage] = useState(false)
	const [allowNetworkStorage, setAllowNetworkStorage] = useState(false)
	const [allowRaidStorage, setAllowRaidStorage] = useState(false)
	const [allowSambaAccess, setAllowSambaAccess] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [isResettingPassword, setIsResettingPassword] = useState(false)
	const [isManagingSessions, setIsManagingSessions] = useState(false)
	const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)
	const [resetPassword, setResetPassword] = useState('')
	const [resetPasswordError, setResetPasswordError] = useState('')
	const deleteInFlightRef = useRef(false)

	const setOwnerPanel = (panel: OwnerPanel | null) => {
		const nextSearchParams = new URLSearchParams(searchParams)
		if (panel) nextSearchParams.set('ownerPanel', panel)
		else nextSearchParams.delete('ownerPanel')
		setSearchParams(nextSearchParams, {replace: true})
	}

	const accountsQ = trpcReact.user.listAccounts.useQuery()
	const accounts = accountsQ.data ?? []
	const owner = accounts.find((account) => account.userId === OWNER_USER_ID)
	const members = accounts.filter((account) => account.userId !== OWNER_USER_ID)
	const memberIds = members.map((member) => member.userId)
	const editingMember = view.view === 'edit' ? members.find((member) => member.userId === view.userId) : undefined
	const shouldLoadMemberData = view.view !== 'owner'
	const sambaAccessQ = trpcReact.files.memberSambaAccess.useQuery(undefined, {enabled: shouldLoadMemberData})
	// Only offer the RAID storage grant on hosts that actually support mdadm.
	const mdadmSupportedQ = trpcReact.hardware.mdadm.isSupported.useQuery(undefined, {retry: false})

	const {
		folderShares,
		appShares,
		sharesReady,
		shareControlsDisabled,
		isError: sharesFailed,
		addAppForUser,
		addFolderForUser,
		removeAppForUser,
		removeFolderForUser,
	} = useUserShares(memberIds, shouldLoadMemberData)
	const appsQ = trpcReact.apps.list.useQuery(undefined, {enabled: shouldLoadMemberData})
	const installedApps = appsQ.data ?? []

	const createUser = trpcReact.user.createUser.useMutation()
	const avatarMutation = useAccountAvatar()
	const resetUserPassword = trpcReact.user.resetUserPassword.useMutation()
	const deleteUser = trpcReact.user.deleteUser.useMutation()
	const setMemberSambaAccess = trpcReact.files.setMemberSambaAccess.useMutation()

	const memberDataFailed = sharesFailed || appsQ.isError
	const memberDataLoading = !sharesReady || appsQ.isLoading
	const loadFailed = accountsQ.isError

	const appNameById = new Map(installedApps.map((app) => [app.id, 'name' in app ? app.name : app.id]))
	const appIconById = new Map(installedApps.map((app) => [app.id, 'icon' in app ? app.icon : undefined]))
	const appDisplayName = (appId: string) => (appId === '*' ? t('users.all-apps') : (appNameById.get(appId) ?? appId))

	const folderDisplayName = (path: string) =>
		path === '/Home' ? homeDirectoryName : (path.split('/').filter(Boolean).pop() ?? path)
	const folderFullPath = (path: string) =>
		path
			.split('/')
			.filter(Boolean)
			.map((segment, index) => (index === 0 && segment === 'Home' ? homeDirectoryName : segment))
			.join(' › ')

	const openAddView = () => {
		const defaults = getNewUserAccessDefaults(appShares, folderShares)
		setIsDeleteConfirmOpen(false)
		setName('')
		setPassword('')
		setPasswordError('')
		setAvatarFile(undefined)
		setPickedAppIds(defaults.pickedAppIds)
		setPickedFolders(defaults.pickedFolderPaths)
		setShareAllApps(defaults.shareAllApps)
		setShareAllFolders(defaults.shareHome)
		setAllowExternalStorage(false)
		setAllowNetworkStorage(false)
		setAllowRaidStorage(false)
		setAllowSambaAccess(false)
		setLocalView({
			view: 'add',
			inheritedAccess: {
				appIds: defaults.inheritedAppIds,
				folderPaths: defaults.inheritedFolderPaths,
			},
		})
	}

	const openEditView = (userId: string) => {
		setIsDeleteConfirmOpen(false)
		setResetPassword('')
		setResetPasswordError('')
		setIsResettingPassword(false)
		setIsManagingSessions(false)
		setLocalView({view: 'edit', userId})
	}

	const openOwnerView = () => {
		setIsDeleteConfirmOpen(false)
		setOwnerPanel('overview')
	}

	const returnToList = () => {
		setIsDeleteConfirmOpen(false)
		setAvatarFile(undefined)
		setResetPassword('')
		setResetPasswordError('')
		setIsResettingPassword(false)
		setIsManagingSessions(false)
		setLocalView({view: 'list'})
		setOwnerPanel(null)
	}

	// The message for a password under the minimum, or '' when it is long enough
	const passwordLengthError = (value: string) =>
		value.length < MIN_PASSWORD_LENGTH ? t('change-password.failed.min-length', {characters: MIN_PASSWORD_LENGTH}) : ''

	const handleCreate = async (event: React.FormEvent) => {
		event.preventDefault()
		// Creation writes the picked shares, so it also waits for sharesReady
		if (view.view !== 'add' || !name.trim() || isCreating || !sharesReady) return

		const lengthError = passwordLengthError(password)
		setPasswordError(lengthError)
		if (lengthError) return

		setIsCreating(true)
		const selectedAvatarFile = avatarFile
		const existingMemberIds = [...memberIds]
		let account: Awaited<ReturnType<typeof createUser.mutateAsync>>
		try {
			account = await createUser.mutateAsync({name: name.trim(), password})
		} catch (error) {
			toast.error(t('users.create-failed'), {
				area: 'settings',
				description: error instanceof Error ? error.message : String(error),
			})
			setIsCreating(false)
			return
		}

		try {
			const accessChanges = planNewUserAccessChanges({
				inheritedAppIds: view.inheritedAccess.appIds,
				inheritedFolderPaths: view.inheritedAccess.folderPaths,
				pickedAppIds,
				pickedFolderPaths: pickedFolders,
				shareAllApps,
				shareHome: shareAllFolders,
				allowExternalStorage,
				allowNetworkStorage,
				allowRaidStorage,
			})
			const shareUpdates = Promise.all([
				...accessChanges.appIdsToAdd.map((appId) => addAppForUser(appId, account.userId)),
				...accessChanges.folderPathsToAdd.map((path) => addFolderForUser(path, account.userId)),
				...accessChanges.appIdsToRemove.map((appId) => removeAppForUser(appId, account.userId, existingMemberIds)),
				...accessChanges.folderPathsToRemove.map((path) =>
					removeFolderForUser(path, account.userId, existingMemberIds),
				),
			])
			const uploadAvatar = async () => {
				if (!selectedAvatarFile) return undefined
				try {
					return (await avatarMutation.upload(account.userId, selectedAvatarFile)).avatarUrl ?? undefined
				} catch (error) {
					toast.error(t('avatar.save-failed'), {
						area: 'settings',
						description: error instanceof Error ? error.message : String(error),
					})
					return undefined
				}
			}
			const updateSambaAccess = async () => {
				if (!allowSambaAccess) return
				try {
					await setMemberSambaAccess.mutateAsync({userId: account.userId, enabled: true})
				} catch (error) {
					toast.error(t('users.samba-access-update-failed'), {
						area: 'settings',
						description: error instanceof Error ? error.message : String(error),
					})
				}
			}
			const [avatarUrl] = await Promise.all([uploadAvatar(), shareUpdates, updateSambaAccess()])

			await Promise.all([
				utils.user.listAccounts.invalidate().catch(() => undefined),
				utils.files.memberSambaAccess.invalidate().catch(() => undefined),
			])
			setLocalView({view: 'created', userId: account.userId, name: name.trim(), password, avatarUrl})
		} catch (error) {
			toast.error(t('users.create-failed'), {
				area: 'settings',
				description: error instanceof Error ? error.message : String(error),
			})
		} finally {
			setAvatarFile(undefined)
			setIsCreating(false)
		}
	}

	const handleAddApp = async (appId: string) => {
		if (view.view === 'add') {
			setPickedAppIds((appIds) => (appIds.includes(appId) ? appIds : [...appIds, appId]))
			return
		}
		if (!editingMember) return
		await addAppForUser(appId, editingMember.userId)
	}

	const handleAddFolder = async (path: string) => {
		setIsFolderPickerOpen(false)
		if (view.view === 'add') {
			setPickedFolders((folders) => (folders.includes(path) ? folders : [...folders, path]))
			return
		}
		if (!editingMember) return
		await addFolderForUser(path, editingMember.userId)
	}

	const handleRemoveApp = async (share: AppShare) => {
		if (!editingMember) return
		await removeAppForUser(share.appId, editingMember.userId)
	}

	const handleRemoveFolder = async (share: FolderShare) => {
		if (!editingMember) return
		await removeFolderForUser(share.path, editingMember.userId)
	}

	const handleResetPassword = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!editingMember || resetUserPassword.isPending) return

		const lengthError = passwordLengthError(resetPassword)
		setResetPasswordError(lengthError)
		if (lengthError) return

		try {
			await resetUserPassword.mutateAsync({userId: editingMember.userId, password: resetPassword})
			setResetPassword('')
			setIsResettingPassword(false)
		} catch (error) {
			toast.error(t('users.reset-password-failed'), {
				area: 'settings',
				description: error instanceof Error ? error.message : String(error),
			})
		}
	}

	const handleDelete = async () => {
		if (!editingMember || deleteInFlightRef.current) return
		deleteInFlightRef.current = true
		setIsDeleting(true)
		try {
			await deleteUser.mutateAsync({userId: editingMember.userId})
			// Deleting a member also removes them from shares server-side
			await Promise.all([
				utils.user.listAccounts.invalidate(),
				utils.files.memberShares.invalidate(),
				utils.files.memberSambaAccess.invalidate(),
				utils.apps.memberShares.invalidate(),
			])
			returnToList()
		} catch (error) {
			toast.error(t('users.delete-failed'), {
				area: 'settings',
				description: error instanceof Error ? error.message : String(error),
			})
		} finally {
			deleteInFlightRef.current = false
			setIsDeleting(false)
		}
	}

	const editingFolderShares = editingMember
		? folderShares.filter((share) => shareCoversUser(share.sharedWith, editingMember.userId))
		: []
	const editingAppShares = editingMember
		? appShares.filter((share) => shareCoversUser(share.sharedWith, editingMember.userId))
		: []

	// Wildcard app, Home, and storage category shares are surfaced as toggles
	// instead of ordinary folder rows.
	const allAppsShare = editingAppShares.find((share) => share.appId === '*')
	const homeFolderShare = editingFolderShares.find((share) => share.path === '/Home')
	const appListShares = editingAppShares.filter((share) => share.appId !== '*')
	const folderListShares = editingFolderShares.filter(
		(share) => share.path !== '/Home' && !isStorageCategoryPath(share.path),
	)
	const shareAllAppsOn = view.view === 'add' ? shareAllApps : !!allAppsShare
	const shareAllFoldersOn = view.view === 'add' ? shareAllFolders : !!homeFolderShare
	const externalStorageShare = folderShares.find((share) => share.path === '/External')
	const networkStorageShare = folderShares.find((share) => share.path === '/Network')
	const raidStorageShare = folderShares.find((share) => share.path === '/Raid')
	const externalStorageOn =
		view.view === 'add'
			? allowExternalStorage
			: !!editingMember &&
				!!externalStorageShare &&
				shareCoversUser(externalStorageShare.sharedWith, editingMember.userId)
	const networkStorageOn =
		view.view === 'add'
			? allowNetworkStorage
			: !!editingMember &&
				!!networkStorageShare &&
				shareCoversUser(networkStorageShare.sharedWith, editingMember.userId)
	const raidStorageOn =
		view.view === 'add'
			? allowRaidStorage
			: !!editingMember && !!raidStorageShare && shareCoversUser(raidStorageShare.sharedWith, editingMember.userId)
	const editingSambaAccess = editingMember
		? sambaAccessQ.data?.find((access) => access.userId === editingMember.userId)
		: undefined
	const sambaAccessOn = view.view === 'add' ? allowSambaAccess : Boolean(editingSambaAccess?.enabled)

	const handleToggleAllApps = async (checked: boolean) => {
		if (view.view === 'add') return setShareAllApps(checked)
		if (checked) await handleAddApp('*')
		else if (allAppsShare) await handleRemoveApp(allAppsShare)
	}

	const handleToggleAllFolders = async (checked: boolean) => {
		if (view.view === 'add') return setShareAllFolders(checked)
		if (checked) await handleAddFolder('/Home')
		else if (homeFolderShare) await handleRemoveFolder(homeFolderShare)
	}

	const handleToggleExternalStorage = async (checked: boolean) => {
		if (view.view === 'add') return setAllowExternalStorage(checked)
		if (!editingMember) return
		if (checked) await addFolderForUser('/External', editingMember.userId)
		else await removeFolderForUser('/External', editingMember.userId)
	}

	const handleToggleNetworkStorage = async (checked: boolean) => {
		if (view.view === 'add') return setAllowNetworkStorage(checked)
		if (!editingMember) return
		if (checked) await addFolderForUser('/Network', editingMember.userId)
		else await removeFolderForUser('/Network', editingMember.userId)
	}

	const handleToggleRaidStorage = async (checked: boolean) => {
		if (view.view === 'add') return setAllowRaidStorage(checked)
		if (!editingMember) return
		if (checked) await addFolderForUser('/Raid', editingMember.userId)
		else await removeFolderForUser('/Raid', editingMember.userId)
	}

	const handleToggleSambaAccess = async (checked: boolean) => {
		if (view.view === 'add') return setAllowSambaAccess(checked)
		if (!editingMember) return
		try {
			await setMemberSambaAccess.mutateAsync({userId: editingMember.userId, enabled: checked})
		} catch (error) {
			toast.error(t('users.samba-access-update-failed'), {
				area: 'settings',
				description: error instanceof Error ? error.message : String(error),
			})
		} finally {
			// The durable toggle may already have changed even if a later Samba
			// reconciliation step failed, so always refresh the authoritative state.
			await utils.files.memberSambaAccess.invalidate().catch(() => undefined)
		}
	}

	const availableApps = installedApps.filter((app) => {
		if (view.view === 'add') return !pickedAppIds.includes(app.id)
		return !editingAppShares.some((share) => share.appId === app.id)
	})
	const disabledFolderPaths = [
		'/Home',
		...(view.view === 'add' ? pickedFolders : folderListShares.map((share) => share.path)),
	]
	const showListView =
		view.view === 'list' || (view.view === 'edit' && !editingMember) || (view.view === 'owner' && !owner)

	const memberShareInfo = (userId: string) => {
		const userFolderShares = folderShares.filter(
			(share) => !isStorageCategoryPath(share.path) && shareCoversUser(share.sharedWith, userId),
		)
		const allFolders = userFolderShares.some((share) => share.path === '/Home')
		const userAppShares = appShares.filter((share) => shareCoversUser(share.sharedWith, userId))
		const allApps = userAppShares.some((share) => share.appId === '*')
		const appIds = allApps ? installedApps.map((app) => app.id) : userAppShares.map((share) => share.appId)
		return {folderCount: userFolderShares.length, allFolders, allApps, appCount: appIds.length, appIds}
	}

	const pickerApps = availableApps.map((app) => ({
		id: app.id,
		name: 'name' in app ? app.name : app.id,
		icon: 'icon' in app && app.icon ? app.icon : undefined,
	}))

	const addAppMenu = (
		<SearchablePicker
			placeholder={t('app-picker.search')}
			items={pickerApps.map((app) => ({
				value: app.id,
				label: app.name || app.id,
				icon: <AppIcon size={24} src={app.icon} className='shrink-0 rounded-6' />,
			}))}
			onSelect={handleAddApp}
		>
			<Button
				size='sm'
				aria-label={t('users.add-app')}
				disabled={availableApps.length === 0 || (view.view === 'edit' && shareControlsDisabled)}
			>
				{t('users.add')}
				<PlusCircle className='h-3 w-3' />
			</Button>
		</SearchablePicker>
	)

	const addFolderButton = (
		<Button
			size='sm'
			aria-label={t('users.add-folder')}
			disabled={view.view === 'edit' && shareControlsDisabled}
			onClick={() => setIsFolderPickerOpen(true)}
		>
			{t('users.add')}
			<PlusCircle className='h-3 w-3' />
		</Button>
	)

	const appShareRow = (appId: string, options: {onRemove: () => void}) => (
		<div className='flex items-center gap-3 p-3'>
			<AppIcon size={32} src={appIconById.get(appId)} className='shrink-0 rounded-8' />
			<span className='min-w-0 flex-1 truncate text-13 font-medium -tracking-2 text-white/90'>
				{appDisplayName(appId)}
			</span>
			<RowRemoveButton
				label={t('users.remove-app', {name: appDisplayName(appId)})}
				disabled={view.view === 'edit' && shareControlsDisabled}
				onClick={options.onRemove}
			/>
		</div>
	)

	const folderShareRow = (path: string, options: {onRemove: () => void}) => (
		<div className='flex items-center gap-3 p-3'>
			<FileItemIcon
				item={{name: folderDisplayName(path), path, type: 'directory', modified: 0, size: 0, operations: []}}
				className='size-8 shrink-0'
			/>
			<div className='min-w-0 flex-1'>
				<div className='truncate text-13 font-medium -tracking-2 text-white/90'>{folderDisplayName(path)}</div>
				{/* rtl + bdi truncates from the left so the deepest folders stay visible */}
				<div dir='rtl' className='truncate text-left text-11 text-white/35'>
					<bdi>{folderFullPath(path)}</bdi>
				</div>
			</div>
			<RowRemoveButton
				label={t('users.remove-folder', {name: folderDisplayName(path)})}
				disabled={view.view === 'edit' && shareControlsDisabled}
				onClick={options.onRemove}
			/>
		</div>
	)

	const isAddingUser = view.view === 'add'
	const appRows = isAddingUser
		? pickedAppIds.map((appId) => (
				<AnimatedRow key={appId}>
					{appShareRow(appId, {
						onRemove: () => setPickedAppIds((appIds) => appIds.filter((id) => id !== appId)),
					})}
				</AnimatedRow>
			))
		: appListShares.map((share) => (
				<AnimatedRow key={share.appId}>
					{appShareRow(share.appId, {onRemove: () => handleRemoveApp(share)})}
				</AnimatedRow>
			))
	const visiblePickedFolders = shareAllFoldersOn
		? pickedFolders.filter((path) => !isCoveredByHomeShare(path))
		: pickedFolders
	const visibleFolderListShares = shareAllFoldersOn
		? folderListShares.filter((share) => !isCoveredByHomeShare(share.path))
		: folderListShares
	const folderRows = isAddingUser
		? visiblePickedFolders.map((path) => (
				<AnimatedRow key={path}>
					{folderShareRow(path, {
						onRemove: () => setPickedFolders((folders) => folders.filter((item) => item !== path)),
					})}
				</AnimatedRow>
			))
		: visibleFolderListShares.map((share) => (
				<AnimatedRow key={share.path}>
					{folderShareRow(share.path, {onRemove: () => handleRemoveFolder(share)})}
				</AnimatedRow>
			))
	const shareSections = memberDataFailed ? (
		<EmptyCard>{t('users.load-failed')}</EmptyCard>
	) : (
		<>
			<ShareSection
				kind='apps'
				compactShareAllLabel={isMobile}
				shareAll={shareAllAppsOn}
				disabled={isAddingUser ? undefined : shareControlsDisabled}
				onShareAllChange={handleToggleAllApps}
				addAction={addAppMenu}
				rows={appRows}
			/>

			<Separator />

			<ShareSection
				kind='folders'
				compactShareAllLabel={isMobile}
				shareAll={shareAllFoldersOn}
				showAdditionalSharesWhenSharingAll
				disabled={isAddingUser ? undefined : shareControlsDisabled}
				onShareAllChange={handleToggleAllFolders}
				addAction={addFolderButton}
				rows={folderRows}
			/>

			<Separator />

			<StorageAccessSection
				externalStorage={externalStorageOn}
				networkStorage={networkStorageOn}
				raidStorage={raidStorageOn}
				showRaidStorage={mdadmSupportedQ.data === true}
				disabled={isAddingUser ? undefined : shareControlsDisabled}
				onExternalStorageChange={handleToggleExternalStorage}
				onNetworkStorageChange={handleToggleNetworkStorage}
				onRaidStorageChange={handleToggleRaidStorage}
			/>

			<Separator />

			<SambaAccessSection
				enabled={sambaAccessOn}
				disabled={
					view.view === 'edit' && (sambaAccessQ.isLoading || sambaAccessQ.isError || setMemberSambaAccess.isPending)
				}
				onEnabledChange={handleToggleSambaAccess}
			/>
		</>
	)

	// Account loading is independent from member-share loading so the owner can
	// still manage their own account if app or folder sharing is unavailable.
	const content = loadFailed ? (
		<div className='flex flex-col gap-5'>
			{!isMobile && (
				<DialogHeader>
					<h2 className='text-17 leading-snug font-semibold -tracking-2'>{t('users')}</h2>
					<p className='text-13 leading-tight text-white/40'>{t('users.description')}</p>
				</DialogHeader>
			)}
			<EmptyCard>{t('users.load-failed')}</EmptyCard>
		</div>
	) : (
		<>
			{showListView && (
				<div className='flex flex-col gap-5'>
					{isMobile ? (
						<p className='text-13 leading-tight -tracking-2 text-white/40 opacity-100'>{t('users.description')}</p>
					) : (
						<DialogHeader>
							<h2 className='text-17 leading-snug font-semibold -tracking-2'>{t('users')}</h2>
							<p className='text-13 leading-tight text-white/40'>{t('users.description')}</p>
						</DialogHeader>
					)}

					<section className='flex flex-col gap-2'>
						<SectionLabel>{t('users.owner')}</SectionLabel>
						<div className={listClass}>
							{accountsQ.isLoading ? (
								<SkeletonRow />
							) : (
								owner && (
									<button
										type='button'
										className={cn(
											'group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/4',
											'outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
											'first:rounded-t-12 last:rounded-b-12',
										)}
										onClick={openOwnerView}
									>
										<AccountAvatar name={owner.name} userId={owner.userId} avatarUrl={owner.avatarUrl} size={32} />
										<span className='min-w-0 flex-1 truncate text-14 font-medium -tracking-2 text-white/90'>
											{owner.name}
										</span>
										<span className='text-12 text-white/30'>{t('users.you')}</span>
										<RowChevron />
									</button>
								)
							)}
						</div>
					</section>

					<section className='flex flex-col gap-2'>
						<div className='flex items-center justify-between'>
							<SectionLabel>{t('users.members')}</SectionLabel>
							<Button
								size='sm'
								aria-label={t('users.add-button')}
								disabled={memberDataFailed || memberDataLoading}
								onClick={openAddView}
							>
								{t('users.add')}
								<PlusCircle className='h-3 w-3' />
							</Button>
						</div>
						{memberDataFailed ? (
							<EmptyCard>{t('users.load-failed')}</EmptyCard>
						) : accountsQ.isLoading || memberDataLoading ? (
							<div className={listClass}>
								<SkeletonRow />
								<SkeletonRow />
							</div>
						) : members.length === 0 ? (
							<EmptyCard>{t('users.no-members')}</EmptyCard>
						) : (
							<div className={listClass}>
								{members.map((member) => {
									const {folderCount, allFolders, allApps, appCount, appIds} = memberShareInfo(member.userId)
									return (
										<button
											key={member.userId}
											type='button'
											className={cn(
												'group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/4',
												'outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
												'first:rounded-t-12 last:rounded-b-12',
											)}
											onClick={() => openEditView(member.userId)}
										>
											<AccountAvatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={32} />
											<span className='min-w-0 flex-1 truncate text-14 font-medium -tracking-2 text-white/90'>
												{member.name}
											</span>
											{folderCount > 0 && (
												<GrantSummary
													folder
													label={allFolders ? t('users.all-folders') : t('users.folder-count', {count: folderCount})}
												/>
											)}
											{(allApps || appCount > 0) && (
												<GrantSummary
													icons={appIds.map((appId) => appIconById.get(appId))}
													label={allApps ? t('users.all-apps') : t('users.app-count', {count: appCount})}
												/>
											)}
											<RowChevron />
										</button>
									)
								})}
							</div>
						)}
					</section>
				</div>
			)}

			{view.view === 'owner' && owner && (
				<OwnerAccountPanel owner={owner} panel={view.panel} onBack={returnToList} onPanelChange={setOwnerPanel} />
			)}

			{view.view === 'add' && (
				<form onSubmit={handleCreate} className='flex flex-col gap-5'>
					<div className='flex flex-col gap-3'>
						<BackButton onClick={returnToList}>{t('users')}</BackButton>
						<h2 className='text-17 leading-snug font-semibold -tracking-2'>{t('users.add-title')}</h2>
						<p className='sr-only'>{t('users.description')}</p>
					</div>

					<div className='flex flex-col items-center gap-4'>
						<AccountAvatarEditor
							account={{name: name.trim(), userId: name.trim() || 'new-user'}}
							disabled={isCreating}
							deferredFile={avatarFile}
							onDeferredFileChange={setAvatarFile}
							className='w-full'
						/>
						<Input autoFocus placeholder={t('users.name-placeholder')} value={name} onValueChange={setName} />
					</div>

					<div className='-mt-2 flex flex-col gap-1.5'>
						<PasswordInput
							label={t('users.password-placeholder')}
							value={password}
							onValueChange={setPassword}
							error={passwordError}
						/>
						<InfoNote>{t('users.password-helper')}</InfoNote>
					</div>

					<Separator />

					{shareSections}

					<Separator />

					<div className='flex justify-end'>
						<Button
							type='submit'
							variant='primary'
							className='relative'
							disabled={!name.trim() || isCreating || !sharesReady}
						>
							<span className={cn(isCreating && 'opacity-0')}>{t('users.create-user')}</span>
							{isCreating && <Loader2 className='absolute size-4 animate-spin' />}
						</Button>
					</div>
				</form>
			)}

			{view.view === 'created' && (
				<div className='flex flex-col items-center gap-5 px-2 py-4 text-center'>
					<motion.div
						className='relative'
						initial={{scale: 0.5, opacity: 0}}
						animate={{scale: 1, opacity: 1}}
						transition={{type: 'spring', stiffness: 300, damping: 20}}
					>
						<AccountAvatar name={view.name} userId={view.userId} avatarUrl={view.avatarUrl} size={96} />
						<div className='absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-brand'>
							<TbCheck className='size-4 text-white' strokeWidth={3} />
						</div>
					</motion.div>
					<div className='flex flex-col gap-1'>
						<h2 className='text-center text-17 leading-normal font-semibold -tracking-2'>
							{t('users.created-title', {name: view.name})}
						</h2>
						<p className='text-center text-13 leading-snug tracking-normal text-white/40 opacity-100'>
							{t('users.created-subtitle')}
						</p>
					</div>
					<InviteMessageCard
						message={t('users.created-message', {
							name: view.name,
							url: window.location.origin,
							password: view.password,
						})}
					/>
					<Button variant='primary' className='min-w-[100px]' onClick={returnToList}>
						{t('done')}
					</Button>
				</div>
			)}

			{view.view === 'edit' &&
				editingMember &&
				(isManagingSessions ? (
					<ManagedSessionsPanel
						userId={editingMember.userId}
						accountName={editingMember.name}
						onBack={() => setIsManagingSessions(false)}
					/>
				) : (
					<div className='flex flex-col gap-5'>
						<div className='flex flex-col gap-3'>
							<BackButton onClick={returnToList}>{t('users')}</BackButton>
							<div className={cn('flex gap-4 pt-2', isMobile ? 'flex-wrap' : 'items-center')}>
								<AccountAvatarEditor account={editingMember} size={72} />
								<div className='min-w-0 flex-1'>
									<h2 className='text-20 truncate leading-snug font-semibold -tracking-2'>{editingMember.name}</h2>
									<p className='text-13 leading-normal tracking-normal text-white/40 opacity-100'>
										{t('users.member')}
									</p>
								</div>
								<div className={cn('flex shrink-0 items-center gap-2', isMobile && 'w-full justify-end')}>
									<Button size='default' className='shrink-0' onClick={() => setIsManagingSessions(true)}>
										{t('active-logins.title')}
									</Button>
									<Button
										size='default'
										className='shrink-0'
										onClick={() => {
											setIsResettingPassword((value) => !value)
											setResetPassword('')
										}}
									>
										{t('users.reset-password')}
									</Button>
									<IconButton
										icon={TbTrash}
										size='icon-only'
										aria-label={t('users.delete-user')}
										className={cn('shrink-0 transition-colors hover:text-destructive', isDeleting && 'umbrel-pulse')}
										disabled={isDeleting}
										onClick={() => setIsDeleteConfirmOpen(true)}
									/>
								</div>
							</div>
						</div>
						<AnimatePresence initial={false}>
							{isResettingPassword && (
								<motion.div
									initial={{height: 0, opacity: 0}}
									animate={{height: 'auto', opacity: 1}}
									exit={{height: 0, opacity: 0}}
									transition={{duration: 0.2}}
									className='-mt-2 overflow-hidden'
								>
									<form onSubmit={handleResetPassword} className='flex flex-col gap-2.5 rounded-12 bg-white/6 p-3'>
										<PasswordInput
											autoFocus
											label={t('users.new-password-placeholder')}
											value={resetPassword}
											onValueChange={setResetPassword}
											error={resetPasswordError}
										/>
										<InfoNote>{t('users.reset-password-helper')}</InfoNote>
										<Button
											type='submit'
											variant='primary'
											className='relative self-center'
											disabled={resetUserPassword.isPending}
										>
											<span className={cn(resetUserPassword.isPending && 'opacity-0')}>
												{t('users.reset-password-confirm')}
											</span>
											{resetUserPassword.isPending && <Loader2 className='absolute size-4 animate-spin' />}
										</Button>
									</form>
								</motion.div>
							)}
						</AnimatePresence>

						<Separator />

						{shareSections}
					</div>
				))}
		</>
	)

	const deleteConfirm = editingMember && (
		<AlertDialog
			open={isDeleteConfirmOpen}
			onOpenChange={(open) => {
				if (!isDeleting) setIsDeleteConfirmOpen(open)
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					{/* mt-1 keeps the badge's negative offset inside the header's scroll clip */}
					<div className='relative mx-auto mt-1 w-fit'>
						<AccountAvatar
							name={editingMember.name}
							userId={editingMember.userId}
							avatarUrl={editingMember.avatarUrl}
							size={64}
						/>
						<div className='absolute -top-1 -right-1 grid size-6 place-items-center rounded-full bg-destructive2 shadow-md'>
							<TbTrash className='size-3.5 text-white' />
						</div>
					</div>
					<AlertDialogTitle>{t('users.delete-confirm.title', {name: editingMember.name})}</AlertDialogTitle>
					<AlertDialogDescription>{t('users.delete-confirm.description')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='destructive' disabled={isDeleting} onClick={handleDelete}>
						{t('users.delete')}
					</AlertDialogAction>
					<AlertDialogCancel disabled={isDeleting}>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)

	const folderPicker = (
		<Suspense>
			{isFolderPickerOpen && (
				<MiniBrowser
					open={isFolderPickerOpen}
					onOpenChange={setIsFolderPickerOpen}
					rootPath='/Home'
					selectionMode='folders'
					preselectOnOpen={false}
					disabledPaths={disabledFolderPaths}
					selectableFilter={(entry) => !shareAllFoldersOn || !isCoveredByHomeShare(entry.path)}
					title={t('users.add-folder')}
					onSelect={handleAddFolder}
				/>
			)}
		</Suspense>
	)
	const dialogTitle =
		loadFailed || showListView
			? t('users')
			: view.view === 'add'
				? t('users.add-title')
				: view.view === 'created'
					? t('users.created-title', {name: view.name})
					: view.view === 'edit' && editingMember
						? isManagingSessions
							? t('active-logins.title')
							: editingMember.name
						: view.view === 'owner'
							? view.panel === 'name'
								? t('change-name')
								: view.panel === 'password'
									? t('change-password')
									: view.panel === 'sessions'
										? t('active-logins.title')
										: (owner?.name ?? t('users.owner'))
							: t('users')
	const dialogDescription = loadFailed
		? t('users.load-failed')
		: showListView
			? t('users.description')
			: view.view === 'created'
				? t('users.created-subtitle')
				: view.view === 'edit' && editingMember
					? isManagingSessions
						? t('active-logins.managed-description', {name: editingMember.name})
						: t('users.member')
					: view.view === 'owner'
						? view.panel === 'sessions'
							? t('active-logins.description')
							: view.panel === 'overview'
								? t('users.owner')
								: t('account')
						: t('users.description')

	if (isMobile) {
		return (
			<>
				<Drawer {...dialogProps}>
					<DrawerContent fullHeight>
						<DrawerHeader className={cn(!showListView && 'sr-only')}>
							<DrawerTitle>{dialogTitle}</DrawerTitle>
							<DrawerDescription className='sr-only'>{dialogDescription}</DrawerDescription>
						</DrawerHeader>
						<DrawerScroller>{content}</DrawerScroller>
					</DrawerContent>
				</Drawer>
				{folderPicker}
				{deleteConfirm}
			</>
		)
	}

	return (
		<>
			<Dialog {...dialogProps}>
				<DialogScrollableContent showClose>
					<DialogHeader className='sr-only'>
						<DialogTitle>{dialogTitle}</DialogTitle>
						<DialogDescription>{dialogDescription}</DialogDescription>
					</DialogHeader>
					<AnimatedHeight>
						<div className='px-5 py-6'>{content}</div>
					</AnimatedHeight>
				</DialogScrollableContent>
			</Dialog>
			{folderPicker}
			{deleteConfirm}
		</>
	)
}

// ─── Shared ─────────────────────────────────────────────────────────

// The pre-composed invite message shown after creating a user — the whole
// card is one big copy button
function InviteMessageCard({message}: {message: string}) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [copied, setCopied] = useState(false)

	return (
		<button
			type='button'
			onClick={async () => {
				copyToClipboard(message)
				setCopied(true)
				await sleep(2000)
				setCopied(false)
			}}
			className='group relative w-full rounded-12 bg-white/6 p-4 pr-11 text-left text-13 leading-relaxed -tracking-2 whitespace-pre-line text-white/80 transition-colors hover:bg-white/8'
		>
			{message}
			<span className='absolute top-3.5 right-3.5'>
				{copied ? (
					<TbCheck className='size-4 text-brand-lighter' />
				) : (
					<TbCopy className='size-4 text-white/30 transition-colors group-hover:text-white/70' />
				)}
			</span>
		</button>
	)
}

function ShareSection({
	kind,
	compactShareAllLabel,
	shareAll,
	showAdditionalSharesWhenSharingAll = false,
	disabled,
	onShareAllChange,
	addAction,
	rows,
}: {
	kind: 'apps' | 'folders'
	compactShareAllLabel?: boolean
	shareAll: boolean
	showAdditionalSharesWhenSharingAll?: boolean
	disabled?: boolean
	onShareAllChange: (checked: boolean) => void
	addAction: React.ReactNode
	rows: React.ReactNode[]
}) {
	const {t} = useTranslation()
	const copy =
		kind === 'apps'
			? {
					title: t('users.shared-apps'),
					shareAllLabel: t('users.share-all-apps'),
					compactShareAllLabel: t('users.all-apps'),
					shareAllTooltip: t('users.share-all-apps-description'),
					shareAllActiveMessage: t('users.share-all-apps-active'),
					emptyMessage: t('users.no-shared-apps'),
				}
			: {
					title: t('users.shared-folders'),
					shareAllLabel: t('users.share-all-folders'),
					compactShareAllLabel: t('users.all-folders'),
					shareAllTooltip: t('users.share-all-folders-description'),
					shareAllActiveMessage: t('users.share-all-folders-active'),
					emptyMessage: t('users.no-shared-folders'),
				}
	const itemCount = rows.length

	return (
		<section className='flex flex-col gap-2'>
			<div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2'>
				<SectionLabel>{copy.title}</SectionLabel>
				<div className='flex items-center gap-3'>
					<ShareAllToggle
						label={compactShareAllLabel ? copy.compactShareAllLabel : copy.shareAllLabel}
						tooltip={copy.shareAllTooltip}
						checked={shareAll}
						disabled={disabled}
						onCheckedChange={onShareAllChange}
					/>
					{!shareAll && addAction}
				</div>
			</div>
			{shareAll && <EmptyCard>{copy.shareAllActiveMessage}</EmptyCard>}
			{!shareAll && itemCount === 0 ? (
				<EmptyCard>{copy.emptyMessage}</EmptyCard>
			) : (!shareAll || showAdditionalSharesWhenSharingAll) && itemCount > 0 ? (
				<div className={shareListClass()}>
					<AnimatePresence initial={false}>{rows}</AnimatePresence>
				</div>
			) : null}
		</section>
	)
}

function StorageAccessSection({
	externalStorage,
	networkStorage,
	raidStorage,
	showRaidStorage,
	disabled,
	onExternalStorageChange,
	onNetworkStorageChange,
	onRaidStorageChange,
}: {
	externalStorage: boolean
	networkStorage: boolean
	raidStorage: boolean
	showRaidStorage: boolean
	disabled?: boolean
	onExternalStorageChange: (checked: boolean) => void
	onNetworkStorageChange: (checked: boolean) => void
	onRaidStorageChange: (checked: boolean) => void
}) {
	const {t} = useTranslation()

	return (
		<section className='flex flex-col gap-2'>
			<SectionLabel>{t('users.storage-access')}</SectionLabel>
			<div className={shareListClass()}>
				<ShareEveryoneRow
					className='p-3'
					title={t('users.usb-storage')}
					description={t('users.usb-storage-description')}
					checked={externalStorage}
					disabled={disabled}
					onCheckedChange={onExternalStorageChange}
				/>
				<ShareEveryoneRow
					className='border-t border-white/6 p-3'
					title={t('users.network-storage')}
					description={t('users.network-storage-description')}
					checked={networkStorage}
					disabled={disabled}
					onCheckedChange={onNetworkStorageChange}
				/>
				{showRaidStorage && (
					<ShareEveryoneRow
						className='border-t border-white/6 p-3'
						title={t('users.raid-storage')}
						description={t('users.raid-storage-description')}
						checked={raidStorage}
						disabled={disabled}
						onCheckedChange={onRaidStorageChange}
					/>
				)}
			</div>
		</section>
	)
}

function SambaAccessSection({
	enabled,
	disabled,
	onEnabledChange,
}: {
	enabled: boolean
	disabled?: boolean
	onEnabledChange: (checked: boolean) => void
}) {
	const {t} = useTranslation()

	return (
		<section className='flex flex-col gap-2'>
			<SectionLabel>{t('settings.file-sharing')}</SectionLabel>
			<div className={shareListClass()}>
				<ShareEveryoneRow
					className='p-3'
					title={t('users.samba-access-toggle')}
					description={t('users.samba-access-description')}
					checked={enabled}
					disabled={disabled}
					onCheckedChange={onEnabledChange}
				/>
			</div>
		</section>
	)
}

function InfoNote({children}: {children: React.ReactNode}) {
	return (
		<div className='flex items-start gap-1.5 px-[5px]'>
			<TbInfoCircle className='mt-0.5 size-3.5 shrink-0 text-white/30' />
			<span className='text-11 leading-snug text-white/35'>{children}</span>
		</div>
	)
}

function SkeletonRow() {
	return (
		<div className='flex items-center gap-3 p-3'>
			<div className='size-8 animate-pulse rounded-full bg-white/8' />
			<div className='flex-1 space-y-1.5'>
				<div className='h-3 w-24 animate-pulse rounded bg-white/8' />
				<div className='h-2.5 w-36 animate-pulse rounded bg-white/8' />
			</div>
		</div>
	)
}
