import {LockIcon, WifiIcon, WifiIcon2, WifiIcon2Circled} from '@/modules/wifi/icon'
import {Connect, wifiListItemClass} from '@/modules/wifi/wifi-drawer-or-dialog'
import {WifiListItemContent} from '@/modules/wifi/wifi-item-content'
import {cn} from '@/shadcn-lib/utils'
import {WifiNetwork} from '@/trpc/trpc'
import {signalToBars} from '@/utils/wifi'

const network: WifiNetwork = {
	ssid: 'My Wifi',
	signal: 100,
	authenticated: true,
}

export default function WifiStory() {
	return (
		<div className='flex flex-col gap-2'>
			<div className='flex text-green-400'>
				<LockIcon />
				<div className='opacity-50'>
					<LockIcon />
				</div>
			</div>
			strength (bars):
			<div className='flex text-green-400'>
				{[0, 1, 2, 3, 4].map((bars) => (
					<div key={bars}>
						<WifiIcon className='size-5' bars={bars} />
						<WifiIcon2 className='size-5' bars={bars} />
						<span>{bars}</span>
					</div>
				))}
			</div>
			strength (signal):
			<div className='flex'>
				{[0, 1, 25, 26, 50, 51, 75, 76, 100].map((signal) => (
					<div key={signal} className='w-[40px]'>
						<WifiIcon2Circled bars={signalToBars(signal)} />
						<span>{signal}</span>
					</div>
				))}
			</div>
			<div className='flex'>
				{[0, 1, 25, 26, 50, 51, 75, 76, 100].map((signal) => (
					<div key={signal} className='w-[40px]'>
						<WifiIcon2Circled bars={signalToBars(signal)} isConnected />
						<span>{signal}</span>
					</div>
				))}
			</div>
			<div
				className={cn(
					'grid size-6 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 bg-white/6',
					'bg-brand',
				)}
			>
				<WifiIcon2 className='size-5' bars={4} />
			</div>
			<div className='overflow-hidden rounded-12 bg-white/6'>
				<div className={wifiListItemClass}>
					<WifiListItemContent network={network} status='connected' />
				</div>
				<div className={wifiListItemClass}>
					<WifiListItemContent network={network} status='disconnected' />
				</div>
				<div className={wifiListItemClass}>
					<WifiListItemContent network={network} status='loading' />
				</div>
				<div className={wifiListItemClass}>
					<WifiListItemContent network={network} error='Network not found' />
				</div>
				<b>Password error for authenticated wifi</b>
				<div className={wifiListItemClass}>
					<WifiListItemContent
						network={{
							...network,
							ssid: 'Voluptate incididunt commodo elit veniam nostrud ipsum minim qui aliqua. Velit minim exercitation laboris consectetur nulla elit id mollit sit velit ea. Sunt sunt commodo incididunt officia esse mollit consequat in ad nulla esse laboris. Laboris cupidatat incididunt duis cupidatat proident deserunt labore. Sint est veniam et aliqua eiusmod cillum ut ex Lorem tempor do ad dolore.',
						}}
						status='disconnected'
					/>
					<Connect
						network={network}
						status='connected'
						onConnect={({ssid, password}) => alert(`ssid:${ssid} pw:${password}`)}
						error='Invalid password'
					/>
				</div>
				<b>Any other error for authenticated wifi</b>
				<div className={wifiListItemClass}>
					<WifiListItemContent
						network={{
							...network,
							ssid: 'Voluptate incididunt commodo elit veniam nostrud ipsum minim qui aliqua. Velit minim exercitation laboris consectetur nulla elit id mollit sit velit ea. Sunt sunt commodo incididunt officia esse mollit consequat in ad nulla esse laboris. Laboris cupidatat incididunt duis cupidatat proident deserunt labore. Sint est veniam et aliqua eiusmod cillum ut ex Lorem tempor do ad dolore.',
						}}
						status='disconnected'
						error='Network not found'
					/>
					<Connect
						network={network}
						status='connected'
						onConnect={({ssid, password}) => alert(`ssid:${ssid} pw:${password}`)}
					/>
				</div>
				<b>Any error for public wifi</b>
				<div className={wifiListItemClass}>
					<WifiListItemContent
						network={{
							...network,
							ssid: 'Unauthenticated',
							authenticated: false,
						}}
						error='Network not found'
					/>
					<Connect
						network={{...network, ssid: 'Unauthenticated', authenticated: false}}
						error='Hello'
						onConnect={({ssid, password}) => alert(`ssid:${ssid} pw:${password}`)}
					/>
				</div>
			</div>
			<div className='pb-10' />
		</div>
	)
}
