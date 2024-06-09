import {TbAlertCircle} from 'react-icons/tb'
import {isString} from 'remeda'

import {Spinner} from '@/components/ui/loading'
import {LockIcon, WifiIcon2Circled} from '@/modules/wifi/icon'
import {WifiNetwork, WifiStatusUi} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {signalToBars} from '@/utils/wifi'

export function WifiListItemContent({
	network,
	status,
	error,
}: {
	network: WifiNetwork
	status?: WifiStatusUi
	error?: string
}) {
	return (
		<div className='flex w-full items-center gap-2.5'>
			<WifiIcon2Circled bars={signalToBars(network.signal)} isConnected={status === 'connected'} />
			<div className='flex flex-1 items-center gap-2 truncate'>
				<h3 className='truncate text-15 font-medium leading-none -tracking-2'>{network.ssid}</h3>
				{network.authenticated && <LockIcon />}
			</div>
			{status === 'loading' && <Spinner />}
			{error && (
				<div className='flex items-center gap-1 text-13 font-medium -tracking-2 text-destructive2-lightest'>
					<TbAlertCircle className='size-4' />
					{isString(error) ? error : t('wifi-connection-failed')}
				</div>
			)}
		</div>
	)
}
