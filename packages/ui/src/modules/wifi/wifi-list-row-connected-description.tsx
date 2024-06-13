import {UNKNOWN} from '@/constants'
import {WifiNetwork} from '@/trpc/trpc'
import {signalToBars} from '@/utils/wifi'

import {LockIcon, WifiIcon2} from './icon'

export function WifiListRowConnectedDescription({network}: {network: Partial<WifiNetwork>}) {
	return (
		// `h-3` prevents height from being different between the `disconnected` and `connected` states
		<span className='flex h-3 items-center gap-1'>
			<WifiIcon2 bars={signalToBars(network.signal ?? 0)} className='size-4' />
			{network.ssid ?? UNKNOWN()}
			{network.authenticated && <LockIcon />}
		</span>
	)
}
