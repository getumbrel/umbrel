import {format} from 'date-fns'

import {WidgetContainer} from './shared/shared'

export function NotificationsWidget({
	link,
	notifications,
}: {
	link?: string
	notifications?: {timestamp: number; description: string}[]
}) {
	return (
		<WidgetContainer href={link} target='_blank' className='cursor-pointer p-2 md:p-4'>
			<div
				className='flex h-full flex-col gap-2 max-sm:gap-0'
				style={{
					maskImage: 'linear-gradient(to bottom, red 50px calc(100% - 50px), transparent)',
				}}
			>
				{notifications?.map((notification, i) => (
					<>
						{i !== 0 && <hr className='border-white/5' />}
						<NotificationItem key={i} timestamp={notification.timestamp} description={notification.description} />
					</>
				))}
			</div>
		</WidgetContainer>
	)
}

function NotificationItem({timestamp, description}: {timestamp?: number; description?: string}) {
	const formattedDate = timestamp ? format(timestamp, 'h:mm aaa · MMM d') : undefined
	return (
		<div className='text-12 leading-tight'>
			{formattedDate && <div className='truncate opacity-20'>{formattedDate}</div>}
			<p className='line-clamp-2 text-11 opacity-80 md:text-12'>{description}</p>
		</div>
	)
}
