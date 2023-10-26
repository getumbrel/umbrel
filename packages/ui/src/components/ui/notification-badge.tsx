export function NotificationBadge({count}: {count: number}) {
	return (
		// min-w so it's a circle when count is below 10
		<div className='absolute -right-1 -top-1 flex h-[17px] min-w-[17px] select-none items-center justify-center rounded-full bg-red-600/80 px-1 text-[11px] font-bold shadow-md shadow-red-800/50'>
			{count}
		</div>
	)
}
