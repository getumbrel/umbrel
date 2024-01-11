import {
	Tb2Fa,
	TbActivityHeartbeat,
	TbArrowBigRightLines,
	TbCircleArrowUp,
	TbLanguage,
	TbPhoto,
	TbRotate2,
	TbServer,
	TbShoppingBag,
	TbTool,
	TbUser,
} from 'react-icons/tb'
import {Link, useNavigate} from 'react-router-dom'

// import {useNavigate} from 'react-router-dom'

import {TorIcon2} from '@/assets/tor-icon2'
import {Card, cardClass} from '@/components/ui/card'
import {LinkButton} from '@/components/ui/link-button'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useQueryParams} from '@/hooks/use-query-params'
import {DesktopPreview, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

import {ListRowMobile} from './list-row'
import {MemoryCard} from './memory-card'
import {ContactSupportLink} from './shared'
import {StorageCard} from './storage-card'
import {TempStatCardContent} from './temp-stat-card-content'

export function SettingsContentMobile() {
	const {addLinkSearchParams} = useQueryParams()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const cpuTempQ = trpcReact.system.cpuTemperature.useQuery()
	const deviceInfo = useDeviceInfo()
	const osVersionQ = trpcReact.system.osVersion.useQuery()
	// const isUmbrelHomeQ = trpcReact.migration.isUmbrelHome.useQuery()
	// const isUmbrelHome = !!isUmbrelHomeQ.data
	const is2faEnabledQ = trpcReact.user.is2faEnabled.useQuery()

	const linkToDialog = useLinkToDialog()

	if (!userQ.data) {
		return null
	}

	return (
		<div className='flex flex-col gap-5 animate-in fade-in'>
			<div className='flex items-center justify-center'>
				<DesktopPreviewFrame>
					<DesktopPreview />
				</DesktopPreviewFrame>
			</div>

			<div className='grid-cols-2 md:grid'>
				<div className='flex items-center gap-[5px] px-2 pb-2.5 md:order-last'>
					<LinkButton to={{search: addLinkSearchParams({dialog: 'logout'})}} size='md-squared' className='flex-grow'>
						Log out
					</LinkButton>
					<LinkButton to={{search: addLinkSearchParams({dialog: 'restart'})}} size='md-squared' className='flex-grow'>
						Restart
					</LinkButton>
					<LinkButton
						to={{
							search: addLinkSearchParams({dialog: 'shutdown'}),
						}}
						size='md-squared'
						text='destructive'
						className='flex-grow'
					>
						Shut down
					</LinkButton>
				</div>

				<div>
					<h2 className='text-24 font-bold lowercase leading-none -tracking-4'>
						{userQ.data.name}’s <span className='opacity-40'>Umbrel</span>
					</h2>
					<div className='pt-5' />
					<dl className='grid grid-cols-2 gap-x-5 gap-y-2 text-14 leading-none -tracking-2'>
						<dt className='opacity-40'>Running on</dt>
						<dd>{deviceInfo.device}</dd>
						<dt className='opacity-40'>umbrelOS version</dt>
						<dd>{osVersionQ.data}</dd>
					</dl>
				</div>
			</div>

			{/* --- */}
			<div className='grid grid-cols-2 gap-2'>
				{/* TODO: `StorageCard` and `TempStatCardContent` are inconsistent */}
				<StorageCard />
				<MemoryCard />
				<Card>
					<TempStatCardContent tempInCelcius={cpuTempQ.data} />
				</Card>
				<Link
					className={cn(cardClass, 'flex flex-col justify-between')}
					to={{
						search: addLinkSearchParams({dialog: 'live-usage'}),
					}}
				>
					<TbActivityHeartbeat className='h-5 w-5 [&>*]:stroke-[1.5px]' />
					<span className='text-12 font-medium leading-inter-trimmed'>Open Live Usage</span>
				</Link>
			</div>

			<div className='umbrel-divide-y rounded-12 bg-white/5 p-1'>
				<ListRowMobile
					icon={TbUser}
					title='Account'
					description='Your display name & Umbrel password'
					onClick={() => navigate(linkToDialog('account'))}
				/>
				<ListRowMobile
					icon={TbPhoto}
					title='Wallpaper'
					description='Choose your Umbrel wallpaper'
					onClick={() => navigate(linkToDialog('wallpaper'))}
				/>
				<ListRowMobile
					icon={Tb2Fa}
					title='Two-factor authentication'
					description='Add a layer of security to login'
					onClick={() => navigate(linkToDialog(is2faEnabledQ.data ? '2fa-disable' : '2fa-enable'))}
				/>
				<ListRowMobile
					icon={TorIcon2}
					title={
						<span className='flex items-center gap-2' onClick={() => navigate(linkToDialog('tor'))}>
							Remote Tor access <TorPulse />
						</span>
					}
					description='Access Umbrel from anywhere using Tor'
					onClick={() => navigate(linkToDialog('tor'))}
				/>
				<ListRowMobile
					icon={TbArrowBigRightLines}
					title='Migration Assistant'
					description='Move data from Raspberry Pi to Umbrel Home'
					onClick={() => navigate(linkToDialog('migration-assistant'))}
				/>
				<ListRowMobile
					icon={TbLanguage}
					title='Language'
					description='Select preferred language'
					onClick={() => navigate(linkToDialog('language'))}
				/>
				<ListRowMobile
					icon={TbShoppingBag}
					title='App store'
					description='App store settings & app updates'
					onClick={() => navigate(linkToDialog('app-store-preferences'))}
				/>
				<ListRowMobile
					icon={TbTool}
					title='Troubleshoot'
					description='View logs for troubleshooting'
					onClick={() => navigate(linkToDialog('troubleshoot'))}
				/>
				<ListRowMobile
					icon={TbServer}
					title='Device info'
					description={`Model ${deviceInfo.modelNumber} · Serial ${deviceInfo.serialNumber}`}
					onClick={() => navigate(linkToDialog('device-info'))}
				/>
				<ListRowMobile
					icon={TbCircleArrowUp}
					title='Software update'
					description='You are on the latest version'
					onClick={() => navigate(linkToDialog('software-update'))}
				/>
				<ListRowMobile
					icon={TbRotate2}
					title='Factory reset'
					description='Delete all data, and reset your device completely'
					onClick={() => navigate('/factory-reset')}
				/>
			</div>

			<ContactSupportLink />
		</div>
	)
}

const TorPulse = () => (
	<div className='inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-[#299E16] ring-3 ring-[#16FF001A]/10' />
)
