import {TbCircleArrowUp} from 'react-icons/tb'

import {ButtonLink} from '@/components/ui/button-link'
import {NotificationBadge} from '@/components/ui/notification-badge'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useLinkToDialog} from '@/utils/dialog'

import {UpdatesDialogConnected} from './updates-dialog'

export function UpdatesButton() {
	const linkToDialog = useLinkToDialog()
	const {appsWithUpdates, isLoading} = useAppsWithUpdates()

	if (isLoading) return null

	// If we link to the updates dialog, show it even if there are no updates
	if (!appsWithUpdates.length) {
		return <UpdatesDialogConnected />
	}

	return (
		<>
			{/* w-auto because 'dialog' size buttons take up full width on mobile */}
			<ButtonLink to={linkToDialog('updates')} size='dialog' className='relative h-[33px] w-auto bg-white/10'>
				<TbCircleArrowUp />
				Updates
				<NotificationBadge count={appsWithUpdates.length} />
			</ButtonLink>
			<UpdatesDialogConnected />
		</>
	)
}
