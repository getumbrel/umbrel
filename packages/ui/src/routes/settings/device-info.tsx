import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {CopyButton} from '@/components/ui/copy-button'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {UNKNOWN} from '@/constants'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {cn} from '@/shadcn-lib/utils'
import {Device, trpcReact} from '@/trpc/trpc'
import {useAfterDelayedClose} from '@/utils/dialog'
import {tw} from '@/utils/tw'

const deviceMap = {
	'umbrel-home': {
		title: 'Umbrel Home',
		icon: '/figma-exports/umbrel-home.svg',
	},
	'raspberry-pi': {
		title: 'Raspberry Pi',
		icon: '/figma-exports/pi.svg',
	},
	linux: {
		title: 'Linux',
		icon: '/figma-exports/tux.svg',
	},
} satisfies Record<Device, {title: string; icon: string}>

export default function DeviceInfoDialog() {
	const title = 'Device Information'
	useUmbrelTitle(title)
	const navigate = useNavigate()

	const osQ = trpcReact.system.osVersion.useQuery()
	const deviceInfoQ = trpcReact.system.deviceInfo.useQuery()

	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	const isLoading = osQ.isLoading || deviceInfoQ.isLoading
	if (isLoading) return null

	const device = deviceInfoQ.data?.device
	if (!device) return null

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogPortal>
				<DialogContent className='p-0'>
					<DialogCloseButton className='absolute right-2 top-2 z-50' />
					<div className='umbrel-dialog-fade-scroller space-y-6 overflow-y-auto px-5 py-6'>
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
						</DialogHeader>
						<div className='flex justify-center py-2'>
							<DeviceIcon device={device} />
						</div>
						<div className={listClass}>
							<div className={listItemClassNarrow}>
								<span>Device</span>
								<span className='pr-6 font-normal'>{deviceMap[device].title || UNKNOWN()}</span>
							</div>
							{deviceInfoQ.data?.modelNumber && (
								<div className={listItemClassNarrow}>
									<span>Model number</span>
									<span className='flex items-center gap-2 font-normal'>
										{deviceInfoQ.data.modelNumber} <CopyButton value={deviceInfoQ.data.modelNumber} />
									</span>
								</div>
							)}
							{deviceInfoQ.data?.serialNumber && (
								<div className={listItemClassNarrow}>
									<span>Serial number</span>
									<span className='flex items-center gap-2 font-normal'>
										{deviceInfoQ.data.serialNumber} <CopyButton value={deviceInfoQ.data.serialNumber} />
									</span>
								</div>
							)}
							<div className={listItemClassNarrow}>
								<span>Software version</span>
								<span className='pr-6 font-normal'>umbrelOS {osQ.data || UNKNOWN()}</span>
							</div>
						</div>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}

const listClass = tw`divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6`
const listItemClass = tw`flex items-center gap-3 px-3 h-[50px] text-15 font-medium -tracking-3 justify-between`
const listItemClassNarrow = cn(listItemClass, tw`h-[42px]`)

export const DeviceIcon = ({device}: {device: Device}) => {
	switch (device) {
		case 'umbrel-home':
			return <img src={deviceMap[device].icon} width={128} height={128} />
		case 'raspberry-pi':
		case 'linux':
			return (
				<IconContainer>
					<img src={deviceMap[device].icon} width={64} height={64} />
				</IconContainer>
			)
	}
}

const IconContainer = ({children}: {children: React.ReactNode}) => (
	<div
		className='grid h-32 w-32 place-items-center rounded-[27px] bg-[#52525252]'
		style={{
			boxShadow: '0 1px 2px #ffffff55 inset',
		}}
	>
		{children}
	</div>
)
