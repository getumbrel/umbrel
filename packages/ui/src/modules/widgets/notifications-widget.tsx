import {useContext} from 'react'

import {cn} from '@/shadcn-lib/utils'

import {BackdropBlurVariantContext} from './shared/backdrop-blur-context'
import {widgetContainerCva} from './shared/shared'

export function NotificationsWidget() {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={cn(widgetContainerCva({variant}), 'justify-between p-2 max-sm:gap-0 md:p-4')}>
			<NotificationItem />
			<hr className='border-white/5' />
			<NotificationItem />
		</div>
	)
}
function NotificationItem() {
	return (
		<div className='text-12 leading-tight'>
			<div className='opacity-20'>12:34 pm · Sep 9</div>
			<p className='line-clamp-2 text-11 opacity-80 md:text-12'>
				✨ Introducing a new feature in our Nostr Relay app for Umbrel. Now you can sync your private relay on Umbrel
				with public relays, and back up past & future Nostr activity, even if the connection between your client & your
				private relay goes down
			</p>
		</div>
	)
}
