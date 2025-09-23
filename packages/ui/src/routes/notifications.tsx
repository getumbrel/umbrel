import {motion} from 'framer-motion'
import {useEffect, useRef, useState} from 'react'

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
import {cn} from '@/shadcn-lib/utils'
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

export function Notifications() {
	const {notifications, clearNotification} = useNotifications()

	const getNotificationContent = (notification: string) => {
		switch (notification) {
			case 'migrated-back-that-mac-up':
				return {
					title: 'Back That Mac Up - Changes Required',
					description:
						'umbrelOS 1.4 introduces Shared Folders over your network, which can also serve as a Time Machine backup location.\nYour current macOS backups using the Back That Mac Up app will no longer work.\nYou can uninstall Back That Mac Up and instead create a new Shared Folder using Files for Time Machine.\nIf you’d still prefer to continue using the Back That Mac Up app:\n1. Go to Time Machine settings.\n2. Remove the backup destination.\n3. Go to Finder.\n4. Press CMD+K and add smb://umbrel.local:1445.\n5. Enter "timemachine" (without quotes) as the username and password.\n6. Go back to Time Machine settings.\n7. Add a new location.\n8. Select Umbrel.\nNote: If you previously used encryption, you will need to enter your encryption password. Time Machine will then resume backups with all your previous data intact.',
				}
			case 'backups-failing':
				return {
					title: t('notifications.backups-failing.title'),
					description: t('notifications.backups-failing.description'),
				}
			default:
				return {
					title: 'Notification',
					description: notification,
				}
		}
	}

	return (
		<>
			{notifications.map((notification) => {
				const content = getNotificationContent(notification)
				return (
					<AlertDialog key={notification} open={true}>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>{content.title}</AlertDialogTitle>
								<div className='pt-2'>
									<NotificationContent>{content.description}</NotificationContent>
								</div>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogAction variant='primary' onClick={() => clearNotification(notification)}>
									OK
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				)
			})}
		</>
	)
}
