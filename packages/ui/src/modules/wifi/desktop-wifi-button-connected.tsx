import {Link} from 'react-router-dom'

import {cn} from '@/lib/utils'
import {WifiIcon2} from '@/modules/wifi/icon'
import {trpcReact} from '@/trpc/trpc'
import {signalToBars} from '@/utils/wifi'

export function DesktopWifiButtonConnected({className}: {className?: string}) {
	const wifiQ = trpcReact.wifi.connected.useQuery()

	if (wifiQ.isLoading || wifiQ.data?.status !== 'connected') return null

	return (
		<Link
			className={cn(
				'animate-in rounded-6 ring-white/20 outline-hidden transition-[background,shadow] fade-in focus-visible:bg-white/6 focus-visible:ring-2 focus-visible:backdrop-blur-xs',
				className,
			)}
			to='/settings/wifi'
		>
			<WifiIcon2 bars={signalToBars(wifiQ.data?.signal ?? 0)} className='size-9' />
		</Link>
	)
}
