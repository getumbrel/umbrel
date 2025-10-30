import {motion} from 'framer-motion'
import {useEffect, useRef, useState} from 'react'
import {RiErrorWarningFill} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {getDeviceNameFromPath} from '@/features/backups/utils/backup-location-helpers'
import {useNotifications} from '@/hooks/use-notifications'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {Button} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'

function NotificationContent({children}: {children: string}) {
	const contentRef = useRef<HTMLDivElement>(null)
	const [isExpanded, setIsExpanded] = useState(false)
	const [showReadMore, setShowReadMore] = useState(false)

	useEffect(() => {
		if (!contentRef.current) return
		const el = contentRef.current
		const WIGGLE_ROOM = 20
		setShowReadMore(el.scrollHeight > el.clientHeight + WIGGLE_ROOM)
	}, [children])

	return (
		<div className='flex flex-col gap-2'>
			<motion.div
				ref={contentRef}
				initial={false}
				animate={{
					height: isExpanded ? 'auto' : '3em',
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
					className='self-center text-xs font-medium text-brand transition-opacity duration-300 hover:opacity-80'
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
	onGoToBackups: () => void,
	onClearNotification: () => void,
): NotificationContent {
	const {repoId} = parseBackupNotificationId(notification)

	// Find repository details if we have a repo ID
	const repository = repoId ? backupRepositoriesQuery.data?.find((r) => r.id === repoId) : null

	// Get device name from path if available
	const deviceName = repository?.path ? getDeviceNameFromPath(repository.path) : null

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
					<div className='absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-[#FF9500]'>
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
	// Hooks and state
	const {notifications, clearNotification} = useNotifications()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()

	// Determine if we need to query backup repositories
	// TODO: remove support for legacy "backups-failing" notification format
	// that was used in umbrelOS 1.5 beta 1 and beta 2 (with no repo ID)
	const hasBackupNotification = notifications.some((n) => n === 'backups-failing' || n.startsWith('backups-failing:'))

	// Query backup repositories (only when needed)
	const backupRepositoriesQuery = trpcReact.backups.getRepositories.useQuery(undefined, {
		enabled: hasBackupNotification,
	})

	// Separate umbrelos-updated notification from others
	const standardNotifications = notifications.filter((n) => n !== 'umbrelos-updated')
	const showWhatsNew = notifications.includes('umbrelos-updated')

	// Navigate to whats-new dialog when the umbrelos-updated notification is present
	// Clear the notification immediately to prevent re-navigation
	useEffect(() => {
		if (showWhatsNew) {
			clearNotification('umbrelos-updated')
			navigate(linkToDialog('whats-new'))
		}
	}, [showWhatsNew, navigate, linkToDialog, clearNotification])

	// Get notification content based on notification type
	const getNotificationContent = (notification: string): NotificationContent => {
		// Handle backup-failing notifications (both legacy and new format with repo ID)
		if (notification === 'backups-failing' || notification.startsWith('backups-failing:')) {
			const onGoToBackups = () => {
				clearNotification(notification)
				navigate('/settings/backups/configure')
			}
			const onClearNotification = () => {
				clearNotification(notification)
			}
			return getBackupFailingContent(notification, backupRepositoriesQuery, onGoToBackups, onClearNotification)
		}

		// Handle specific notification types
		if (notification === 'migrated-back-that-mac-up') {
			return getMigratedBackThatMacUpContent()
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
