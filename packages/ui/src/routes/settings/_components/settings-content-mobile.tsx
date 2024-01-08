import {RiPulseLine} from 'react-icons/ri'
import {
	Tb2Fa,
	TbArrowBigRightLines,
	TbCircleArrowUp,
	TbLanguage,
	TbPhoto,
	TbShoppingBag,
	TbTool,
	TbUser,
} from 'react-icons/tb'

// import {useNavigate} from 'react-router-dom'

import {TorIcon2} from '@/assets/tor-icon2'
import {Card} from '@/components/ui/card'
import {IconLinkButton} from '@/components/ui/icon-link-button'
import {LinkButton} from '@/components/ui/link-button'
import {useQueryParams} from '@/hooks/use-query-params'
import {DesktopPreview, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {trpcReact} from '@/trpc/trpc'

import {ListRowMobile} from './list-row'
import {MemoryCard} from './memory-card'
import {ContactSupportLink} from './shared'
import {StorageCard} from './storage-card'
import {TempStatCardContent} from './temp-stat-card-content'

export function SettingsContentMobile() {
	const {addLinkSearchParams} = useQueryParams()
	// const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const cpuTempQ = trpcReact.system.cpuTemperature.useQuery()
	// const isUmbrelHomeQ = trpcReact.migration.isUmbrelHome.useQuery()
	// const isUmbrelHome = !!isUmbrelHomeQ.data
	// const is2faEnabledQ = trpcReact.user.is2faEnabled.useQuery()

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
						<dd>DEBUG 4</dd>
						<dt className='opacity-40'>umbrelOS version</dt>
						<dd>0.0.0 </dd>
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
				<Card>
					<IconLinkButton
						icon={RiPulseLine}
						to={{
							search: addLinkSearchParams({dialog: 'live-usage'}),
						}}
					>
						Open Live Usage
					</IconLinkButton>
				</Card>
			</div>

			<div className='umbrel-divide-y rounded-12 bg-white/5 p-1'>
				<ListRowMobile icon={TbUser} title='Account' description='Your display name & Umbrel password' />
				<ListRowMobile icon={TbPhoto} title='Wallpaper' description='Choose your Umbrel wallpaper' />
				<ListRowMobile icon={Tb2Fa} title='Two-factor authentication' description='Add a layer of security to login' />
				<ListRowMobile icon={TorIcon2} title='Remote Tor access' description='Access Umbrel from anywhere using Tor' />
				<ListRowMobile
					icon={TbArrowBigRightLines}
					title='Migration Assistant'
					description='Move data from Raspberry Pi to Umbrel Home'
				/>
				<ListRowMobile icon={TbLanguage} title='Language' description='Select preferred language ' />
				<ListRowMobile icon={TbShoppingBag} title='App store' description='App store settings & app updates' />
				<ListRowMobile icon={TbTool} title='Troubleshoot' description='View logs for troubleshooting' />
				<ListRowMobile icon={TbCircleArrowUp} title='Software update' description='You are on the latest version' />
			</div>

			<ContactSupportLink />
		</div>
	)
}
