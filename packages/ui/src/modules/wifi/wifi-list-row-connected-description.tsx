import {UNKNOWN} from '@/constants'
import {WifiNetwork} from '@/trpc/trpc'
import {signalToBars} from '@/utils/wifi'

import {LockIcon, WifiIcon2} from './icon'

export function WifiListRowConnectedDescription({network}: {network: Partial<WifiNetwork>}) {
	return (
		// One line of the text, as the `disconnected` description is, so the taller icon doesn't change the row's height
		<span className='flex h-[1lh] items-center gap-1'>
			<WifiIcon2 bars={signalToBars(network.signal ?? 0)} className='size-4' />
			{/* A long network name ends in an ellipsis and keeps the lock in view */}
			<span className='truncate'>{network.ssid ?? UNKNOWN()}</span>
			{network.authenticated && <LockIcon />}
		</span>
	)
}
