import {TFunction} from 'i18next'
import {motion} from 'motion/react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {RiErrorWarningFill} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {toast} from '@/components/ui/toast'
import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {useDescribeBackupLocation} from '@/features/backups/hooks/use-describe-backup-location'
import {CloudBreakDiagram} from '@/features/files/components/cloud-break-diagram'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import {cloudAccountBrand} from '@/features/files/utils/cloud'
import {useLargerText} from '@/hooks/use-accessibility'
import {ONBOARDING_COMPLETE_NOTIFICATION, useNotifications} from '@/hooks/use-notifications'
import {cn} from '@/lib/utils'
import {SettingsListIcon} from '@/routes/settings/_components/list-row'
import {suppliedSettingsIcons} from '@/routes/settings/_components/settings-taxonomy'
import {thunderboltAccessoryImage} from '@/routes/settings/thunderbolt'
import {shouldShowWhatsNew} from '@/routes/whats-new'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {focusRingClass} from '@/utils/element-classes'

function NotificationContent({children}: {children: string}) {
	const {t} = useTranslation()
	const contentRef = useRef<HTMLDivElement>(null)
	const [isExpanded, setIsExpanded] = useState(false)
	const [showReadMore, setShowReadMore] = useState(false)
	// Three lines of the description (text-13, leading-tight), which grow with the text size
	const collapsedHeight = (13 + useLargerText()) * 1.25 * 3

	useEffect(() => {
		if (!contentRef.current) return
		const el = contentRef.current
		const WIGGLE_ROOM = 20
		setShowReadMore(el.scrollHeight > el.clientHeight + WIGGLE_ROOM)
	}, [children, collapsedHeight])

	return (
		<div className='flex flex-col gap-2'>
			<motion.div
				ref={contentRef}
				initial={false}
				animate={{
					height: isExpanded ? 'auto' : collapsedHeight,
				}}
				transition={{
					duration: 0.4,
					ease: [0.32, 0.72, 0, 1],
				}}
				className='overflow-hidden'
				style={{
					WebkitMaskImage:
						isExpanded || !showReadMore ? undefined : 'linear-gradient(to bottom, black, black, transparent)',
				}}
			>
				<div className={cn('text-sm')}>
					{children.split('\n').map((paragraph, index) => (
						<AlertDialogDescription key={index} className={`${index > 0 ? 'mt-4' : ''} text-white/70`}>
							{paragraph}
						</AlertDialogDescription>
					))}
				</div>
			</motion.div>
			{showReadMore && (
				<button
					onClick={() => setIsExpanded(true)}
					tabIndex={isExpanded ? -1 : 0}
					className={cn(
						'self-center rounded-4 px-1 text-xs font-medium text-brand transition-opacity duration-300 hover:opacity-80',
						focusRingClass,
					)}
					style={{
						opacity: isExpanded ? 0 : 1,
						pointerEvents: isExpanded ? 'none' : 'auto',
					}}
				>
					{t('read-more')}
				</button>
			)}
		</div>
	)
}

type NotificationContent = {
	title: string
	description: string
	icon?: React.ReactNode
	action?: React.ReactNode
}

/**
 * Parses backup notification ID to extract repository ID if present.
 * Format: "backups-failing" (legacy) or "backups-failing:<repo-id>" (new)
 * TODO: remove support for legacy "backups-failing" notification format
 * that was used in umbrelOS 1.5 beta 1 and beta 2 (with no repo ID).
 */
function parseBackupNotificationId(notification: string): {repoId: string | null} {
	if (notification.startsWith('backups-failing:') && notification.includes(':')) {
		return {repoId: notification.split(':')[1]}
	}
	return {repoId: null}
}

/**
 * Handles backup-failing notifications by fetching repo details
 * and generating appropriate content with device-specific information.
 */
function getBackupFailingContent(
	notification: string,
	backupRepositoriesQuery: {data?: Array<{id: string; path: string}>},
	describeBackupLocation: ReturnType<typeof useDescribeBackupLocation>,
	onGoToBackups: () => void,
	onClearNotification: () => void,
	t: TFunction,
): NotificationContent {
	const {repoId} = parseBackupNotificationId(notification)

	// Find repository details if we have a repo ID
	const repository = repoId ? backupRepositoriesQuery.data?.find((r) => r.id === repoId) : null

	// Name the drive or NAS if we know where the repository is
	const deviceName = repository?.path ? describeBackupLocation(repository.path).name : null

	const actionButtons = (
		<>
			<Button variant='default' size='dialog' onClick={onClearNotification} tabIndex={-1}>
				{t('ok')}
			</Button>
			<AlertDialogAction variant='primary' onClick={onGoToBackups} tabIndex={0}>
				{t('notifications.backups-failing.go-to-backups')}
			</AlertDialogAction>
		</>
	)

	// Use specific content when we have repository details
	if (repository && deviceName) {
		return {
			title: t('notifications.backups-failing.title'),
			description: t('notifications.backups-failing-location.description', {location: deviceName}),
			icon: (
				<div className='relative'>
					<BackupDeviceIcon path={repository.path} className='size-14 opacity-90' />
					<div className='absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-[#FF9500]'>
						<RiErrorWarningFill className='size-5 text-black' />
					</div>
				</div>
			),
			action: actionButtons,
		}
	}

	// Fall back to generic message for legacy format or when repo not found
	return {
		title: t('notifications.backups-failing.title'),
		description: t('notifications.backups-failing.description'),
		action: actionButtons,
	}
}

/**
 * Handles "Back That Mac Up" migration notification.
 */
function getMigratedBackThatMacUpContent(): NotificationContent {
	return {
		title: 'Back That Mac Up - Changes Required',
		description:
			'umbrelOS 1.4 introduces Shared Folders over your network, which can also serve as a Time Machine backup location.\nYour current macOS backups using the Back That Mac Up app will no longer work.\nYou can uninstall Back That Mac Up and instead create a new Shared Folder using Files for Time Machine.\nIf you’d still prefer to continue using the Back That Mac Up app:\n1. Go to Time Machine settings.\n2. Remove the backup destination.\n3. Go to Finder.\n4. Press CMD+K and add smb://umbrel.local:1445.\n5. Enter "timemachine" (without quotes) as the username and password.\n6. Go back to Time Machine settings.\n7. Add a new location.\n8. Select Umbrel.\nNote: If you previously used encryption, you will need to enter your encryption password. Time Machine will then resume backups with all your previous data intact.',
	}
}

/**
 * Fallback handler for unknown notification types.
 */
function getDefaultNotificationContent(notification: string): NotificationContent {
	return {
		title: 'Notification',
		description: notification,
	}
}

export function Notifications() {
	const {t} = useTranslation()
	// Hooks and state
	const {notifications, clearNotification} = useNotifications()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const homePath = useHomePath()
	const versionQ = trpcReact.system.version.useQuery()
	const utils = trpcReact.useUtils()

	// Determine if we need to query backup repositories
	// TODO: remove support for legacy "backups-failing" notification format
	// that was used in umbrelOS 1.5 beta 1 and beta 2 (with no repo ID)
	const hasBackupNotification = notifications.some((n) => n === 'backups-failing' || n.startsWith('backups-failing:'))

	// Query backup repositories (only when needed)
	const backupRepositoriesQuery = trpcReact.backups.getRepositories.useQuery(undefined, {
		enabled: hasBackupNotification,
	})
	const describeBackupLocation = useDescribeBackupLocation({enabled: hasBackupNotification})

	// Query apps to resolve app names for app storage notifications (only when
	// needed). This component renders outside AppsProvider so we query directly.
	const hasAppStorageNotification = notifications.some((n) => n.startsWith('app-storage-settings-changed:'))
	const appsQuery = trpcReact.apps.list.useQuery(undefined, {
		enabled: hasAppStorageNotification,
	})

	// Query cloud accounts (only when a cloud auth notification is present)
	const hasCloudNotification = notifications.some((n) => n.startsWith('cloud-auth:'))
	const cloudAccountsQuery = trpcReact.files.cloud.accounts.useQuery(undefined, {
		enabled: hasCloudNotification,
	})

	// Unknown Thunderbolt devices remain blocked until the device owner grants
	// access. Device-level notifications are never returned to member accounts.
	const hasThunderboltNotification = notifications.some((n) => n.startsWith('thunderbolt-authorization-required:'))
	const pendingThunderboltDevicesQuery = trpcReact.hardware.thunderbolt.getPendingDevices.useQuery(undefined, {
		enabled: hasThunderboltNotification,
		// Events keep the prompt's device state current across brief disconnects;
		// polling covers a missed or temporarily disconnected subscription.
		refetchInterval: 30_000,
	})
	const invalidatePendingThunderboltDevices = () => utils.hardware.thunderbolt.getPendingDevices.invalidate()
	trpcReact.eventBus.listen.useSubscription(
		{event: 'hardware:thunderbolt:devices-change'},
		{
			enabled: hasThunderboltNotification,
			onStarted: invalidatePendingThunderboltDevices,
			onData: invalidatePendingThunderboltDevices,
			onError: (error) => console.error('hardware:thunderbolt:devices-change subscription error', error),
		},
	)
	const invalidateThunderbolt = async () => {
		await Promise.all([
			utils.notifications.get.invalidate(),
			utils.hardware.thunderbolt.getPendingDevices.invalidate(),
			utils.hardware.thunderbolt.getDevices.invalidate(),
		])
	}
	const thunderboltActionError = (error: unknown) => {
		const message = error instanceof Error ? error.message : t('unknown-error')
		toast.error(t('thunderbolt-settings.action-error', {message}), {
			icon: (
				<img src={thunderboltAccessoryImage} alt='' draggable={false} className='size-10 shrink-0 object-contain' />
			),
		})
	}
	const authorizeThunderboltDevice = trpcReact.hardware.thunderbolt.authorize.useMutation({
		onSuccess: invalidateThunderbolt,
		onError: thunderboltActionError,
	})
	// Denying maps to revoke: the device stays blocked and the prompt stays
	// away while it remains plugged in; reconnecting it asks again
	const denyThunderboltDevice = trpcReact.hardware.thunderbolt.revoke.useMutation({
		onSuccess: invalidateThunderbolt,
		onError: thunderboltActionError,
	})

	// Separate notifications handled elsewhere from the ones rendered here as
	// alerts: umbrelos-updated opens What's New below, onboarding-complete is
	// the welcome desktop's
	const standardNotifications = notifications.filter(
		(n) => n !== 'umbrelos-updated' && n !== ONBOARDING_COMPLETE_NOTIFICATION,
	)
	const showWhatsNew = notifications.includes('umbrelos-updated')

	// Navigate to whats-new dialog when the umbrelos-updated notification is present
	// Clear the notification immediately to prevent re-navigation
	useEffect(() => {
		if (showWhatsNew && versionQ.isLoading) return

		if (showWhatsNew) {
			clearNotification('umbrelos-updated')
			if (shouldShowWhatsNew(versionQ.data?.previousVersion)) {
				navigate(linkToDialog('whats-new'))
			}
		}
	}, [showWhatsNew, versionQ.isLoading, versionQ.data?.previousVersion, navigate, linkToDialog, clearNotification])

	// Get notification content based on notification type
	const getNotificationContent = (notification: string): NotificationContent => {
		if (notification === 'raid-scrub-errors') {
			const onGoToStorageManager = () => {
				clearNotification(notification)
				navigate('/settings/storage')
			}
			return {
				title: t('notifications.raid.issue.title'),
				icon: (
					<div className='relative'>
						<SettingsListIcon
							icon={suppliedSettingsIcons.storageManager}
							className='size-16 rounded-20 [--settings-row-tone:var(--color-brand)]'
							iconClassName='size-9'
						/>
						<RiErrorWarningFill className='absolute -top-2 -right-2 size-8 text-[#FF3434] drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]' />
					</div>
				),
				description: t('notifications.raid.issue.description'),
				action: (
					<>
						<Button variant='default' size='dialog' onClick={() => clearNotification(notification)} tabIndex={-1}>
							{t('notifications.dismiss')}
						</Button>
						<AlertDialogAction variant='primary' onClick={onGoToStorageManager} tabIndex={0}>
							{t('notifications.raid.issue.action')}
						</AlertDialogAction>
					</>
				),
			}
		}

		// Handle backup-failing notifications (both legacy and new format with repo ID)
		if (notification === 'backups-failing' || notification.startsWith('backups-failing:')) {
			const onGoToBackups = () => {
				clearNotification(notification)
				navigate('/settings/backups/configure')
			}
			const onClearNotification = () => {
				clearNotification(notification)
			}
			return getBackupFailingContent(
				notification,
				backupRepositoriesQuery,
				describeBackupLocation,
				onGoToBackups,
				onClearNotification,
				t,
			)
		}

		// Handle cloud auth notifications: cloud-auth:<accountId>
		if (notification.startsWith('cloud-auth:')) {
			const accountId = notification.split(':')[1]
			const account = cloudAccountsQuery.data?.find(({id}) => id === accountId)
			const onSignIn = () => {
				clearNotification(notification)
				navigate(
					`/files${homePath}?dialog=files-cloud-add&files-cloud-add-account=${accountId}&files-cloud-add-reauth=1`,
				)
			}
			return {
				title: t('notifications.cloud-auth.title'),
				icon: <CloudBreakDiagram provider={account && cloudAccountBrand(account)} glyph='alert' />,
				description: account
					? t('notifications.cloud-auth.description', {account: account.displayName})
					: t('notifications.cloud-auth.description-generic'),
				action: (
					<>
						<Button variant='default' size='dialog' onClick={() => clearNotification(notification)} tabIndex={-1}>
							{t('ok')}
						</Button>
						<AlertDialogAction variant='primary' onClick={onSignIn} tabIndex={0}>
							{t('notifications.cloud-auth.sign-in')}
						</AlertDialogAction>
					</>
				),
			}
		}

		if (notification.startsWith('thunderbolt-authorization-required:')) {
			// Device ids are kernel-provided UUIDs, so they are matched verbatim.
			// URI-decoding could throw on a malformed stored notification, which
			// would crash the whole app since this component mounts at the root.
			const id = notification.slice('thunderbolt-authorization-required:'.length)
			const device = pendingThunderboltDevicesQuery.data?.find((candidate) => candidate.id === id)
			const deviceName =
				[device?.vendor, device?.name].filter(Boolean).join(' ') || t('notifications.thunderbolt.accessory')
			return {
				title: t('notifications.thunderbolt.title'),
				icon: <img src={thunderboltAccessoryImage} alt='' draggable={false} className='w-20' />,
				description: t('notifications.thunderbolt.description', {device: deviceName}),
				action: (
					<>
						<AlertDialogAction
							variant='default'
							disabled={!device || authorizeThunderboltDevice.isPending || denyThunderboltDevice.isPending}
							onClick={() => denyThunderboltDevice.mutate({id})}
							tabIndex={0}
						>
							{t('notifications.thunderbolt.dont-allow')}
						</AlertDialogAction>
						<AlertDialogAction
							variant='primary'
							disabled={authorizeThunderboltDevice.isPending || denyThunderboltDevice.isPending}
							onClick={() => authorizeThunderboltDevice.mutate({id})}
							tabIndex={0}
						>
							{authorizeThunderboltDevice.isPending
								? t('notifications.thunderbolt.allowing')
								: t('notifications.thunderbolt.allow')}
						</AlertDialogAction>
					</>
				),
			}
		}

		// Handle specific notification types
		if (notification === 'migrated-back-that-mac-up') {
			return getMigratedBackThatMacUpContent()
		}

		// Handle app storage settings invalidated by an app update
		if (notification.startsWith('app-storage-settings-changed:')) {
			const appId = notification.split(':')[1]
			const app = appsQuery.data?.find((app) => app.id === appId)
			const appName = (app && 'name' in app && app.name) || appId
			return {
				title: t('notifications.app-storage-settings-changed.title'),
				description: t('notifications.app-storage-settings-changed.description', {app: appName}),
				action: (
					<>
						<Button variant='default' size='dialog' onClick={() => clearNotification(notification)} tabIndex={-1}>
							{t('ok')}
						</Button>
						<AlertDialogAction
							variant='primary'
							onClick={() => {
								clearNotification(notification)
								navigate(linkToDialog('app-settings', {for: appId, view: 'storage'}))
							}}
							tabIndex={0}
						>
							{t('notifications.app-storage-settings-changed.review')}
						</AlertDialogAction>
					</>
				),
			}
		}

		// Default fallback for unknown notifications
		return getDefaultNotificationContent(notification)
	}

	return (
		<>
			{standardNotifications.map((notification) => {
				const content = getNotificationContent(notification)
				return (
					<AlertDialog key={notification} open={true}>
						<AlertDialogContent>
							<AlertDialogHeader>
								{content.icon && <div className='flex items-center justify-center py-2'>{content.icon}</div>}
								<AlertDialogTitle>{content.title}</AlertDialogTitle>
								<NotificationContent>{content.description}</NotificationContent>
							</AlertDialogHeader>
							<AlertDialogFooter>
								{content.action || (
									<AlertDialogAction variant='primary' onClick={() => clearNotification(notification)} tabIndex={0}>
										{t('ok')}
									</AlertDialogAction>
								)}
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				)
			})}
		</>
	)
}
