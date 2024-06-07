import {Link} from 'react-router-dom'

import {WifiIcon2} from '@/modules/wifi/icon'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {signalToBars} from '@/utils/wifi'

export function DesktopWifiButtonConnected({className}: {className?: string}) {
	const wifiQ = trpcReact.wifi.connected.useQuery()

	if (wifiQ.isLoading || wifiQ.data?.status !== 'connected') return null

	return (
		<Link
			className={cn(
				'rounded-6 outline-none ring-white/20 transition-[background,shadow] animate-in fade-in focus-visible:bg-white/6 focus-visible:ring-2 focus-visible:backdrop-blur-sm',
				className,
			)}
			to='/settings/wifi'
		>
			<WifiIcon2 bars={signalToBars(wifiQ.data?.signal ?? 0)} className='size-9' />
		</Link>
	)
}
