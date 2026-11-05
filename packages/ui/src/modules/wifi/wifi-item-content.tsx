import {useTranslation} from 'react-i18next'
import {TbAlertCircle} from 'react-icons/tb'
import {isString} from 'remeda'

import {Spinner} from '@/components/ui/loading'
import {LockIcon, WifiIcon2Circled} from '@/modules/wifi/icon'
import {WifiNetwork, WifiStatusUi} from '@/trpc/trpc'
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
	const {t} = useTranslation()
	return (
		<div className='flex w-full items-center gap-2.5'>
			<WifiIcon2Circled bars={signalToBars(network.signal)} isConnected={status === 'connected'} />
			{/* A failed connection says why under the network's name, so neither a long
			    name nor a long message pushes the other out of the row */}
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-2'>
					<h3 className='truncate text-15 leading-none font-medium -tracking-2'>{network.ssid}</h3>
					{network.authenticated && <LockIcon />}
				</div>
				{error && (
					<p className='mt-1.5 flex items-center gap-1 text-13 font-medium -tracking-2 text-destructive2-lightest'>
						<TbAlertCircle className='size-4 shrink-0' />
						{isString(error) ? error : t('wifi-connection-failed')}
					</p>
				)}
			</div>
			{status === 'loading' && <Spinner />}
		</div>
	)
}
