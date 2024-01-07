import {formatDistance} from 'date-fns'
import {useEffect} from 'react'
import {
	RiEqualizerLine,
	RiExpandRightFill,
	RiKeyLine,
	RiLogoutCircleRLine,
	RiPulseLine,
	RiRestartLine,
	RiShutDownLine,
	RiUserLine,
} from 'react-icons/ri'
import {TbRotate2, TbServer, TbTool} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {Card} from '@/components/ui/card'
import {IconButton} from '@/components/ui/icon-button'
import {IconLinkButton} from '@/components/ui/icon-link-button'
import {deviceMap, UNKNOWN} from '@/constants'
import {useQueryParams} from '@/hooks/use-query-params'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {DesktopPreview, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {Switch} from '@/shadcn-components/ui/switch'
import {trpcReact} from '@/trpc/trpc'

import {LanguageDropdown} from './language-dropdown'
import {ListRow} from './list-row'
import {MemoryCard} from './memory-card'
import {ContactSupportLink} from './shared'
import {SoftwareUpdateListRow} from './software-update-list-row'
import {StorageCard} from './storage-card'
import {TempStatCardContent} from './temp-stat-card-content'
import {WallpaperPicker} from './wallpaper-picker'

export function SettingsContent() {
	const {addLinkSearchParams} = useQueryParams()
	const navigate = useNavigate()
	const tor = useTorEnabled()

	const [userQ, uptimeQ, deviceInfoQ, cpuTempQ, isUmbrelHomeQ, is2faEnabledQ, osVersionQ] = trpcReact.useQueries(
		(t) => [
			t.user.get(),
			t.system.uptime(),
			t.system.deviceInfo(),
			t.system.cpuTemperature(),
			t.migration.isUmbrelHome(),
			t.user.is2faEnabled(),
			t.system.osVersion(),
		],
	)

	const isUmbrelHome = !!isUmbrelHomeQ.data

	// TODO: also wanna check CPU temp
	const isLoading =
		userQ.isLoading || uptimeQ.isLoading || deviceInfoQ.isLoading || is2faEnabledQ.isLoading || osVersionQ.isLoading

	// Scroll to hash
	useEffect(() => {
		if (isLoading) return

		if (location.hash) {
			const el = document.querySelector(location.hash)
			if (el) {
				el.scrollIntoView({behavior: 'instant', block: 'center'})
			}
		}
	}, [isLoading])

	if (isLoading) {
		return null
	}
	return (
		<div className='animate-in fade-in'>
			<div className='grid w-full gap-x-[30px] gap-y-[20px] lg:grid-cols-[280px_auto]'>
				<div className='flex items-center justify-center'>
					<DesktopPreviewFrame>
						<DesktopPreview />
					</DesktopPreviewFrame>
				</div>
				<Card className='flex flex-wrap items-center justify-between gap-y-5'>
					<div>
						<h2 className='text-24 font-bold lowercase leading-none -tracking-4'>
							{userQ.data?.name || 'Unknown'}’s <span className='opacity-40'>Umbrel</span>
						</h2>
						<div className='pt-5' />
						<dl className='grid grid-cols-2 gap-x-5 gap-y-2 text-14 leading-none -tracking-2'>
							<dt className='opacity-40'>Running on</dt>
							<dd>{deviceInfoQ.data?.device ? deviceMap[deviceInfoQ.data?.device].title : UNKNOWN()}</dd>
							<dt className='opacity-40'>umbrelOS version</dt>
							<dd>{osVersionQ.data}</dd>
							<dt className='opacity-40'>Uptime</dt>
							<dd>{duration(uptimeQ.data)}</dd>
						</dl>
					</div>
					<div className='flex w-full flex-col items-stretch gap-2.5 md:w-auto md:flex-row'>
						<IconLinkButton to={{search: addLinkSearchParams({dialog: 'logout'})}} size='xl' icon={RiLogoutCircleRLine}>
							Log out
						</IconLinkButton>
						<IconLinkButton to={{search: addLinkSearchParams({dialog: 'restart'})}} size='xl' icon={RiRestartLine}>
							Restart
						</IconLinkButton>
						<IconLinkButton
							to={{
								search: addLinkSearchParams({dialog: 'shutdown'}),
							}}
							size='xl'
							text='destructive'
							icon={RiShutDownLine}
						>
							Shut down
						</IconLinkButton>
					</div>
				</Card>
				<div className='flex flex-col gap-3'>
					<StorageCard />
					{/* Choosing middle card because we wanna scroll to center to likely see them all */}
					<MemoryCard />
					<Card>
						<TempStatCardContent tempInCelcius={cpuTempQ.data} />
					</Card>
					<div className='mx-auto'>
						<IconLinkButton
							icon={RiPulseLine}
							to={{
								search: addLinkSearchParams({dialog: 'live-usage'}),
							}}
						>
							Open Live Usage
						</IconLinkButton>
					</div>
					<div className='flex-1' />
					<ContactSupportLink className='max-lg:hidden' />
				</div>
				<Card className='umbrel-divide-y overflow-hidden !py-2'>
					<ListRow title='Account' description='Your display name & Umbrel password'>
						<div className='flex flex-wrap gap-2'>
							<IconLinkButton to={{search: addLinkSearchParams({dialog: 'change-name'})}} icon={RiUserLine}>
								Change name
							</IconLinkButton>
							<IconLinkButton to={{search: addLinkSearchParams({dialog: 'change-password'})}} icon={RiKeyLine}>
								Change password
							</IconLinkButton>
						</div>
					</ListRow>
					<ListRow title='Wallpaper' description='Choose your Umbrel wallpaper'>
						{/* -mx-2 so that when last item is active, it right aligns with other list row buttons, and first item aligns on mobile when picker wrapped down */}
						{/* w-full to prevent overflow issues */}
						<div className='-mx-2 max-w-full'>
							<WallpaperPicker delayed />
						</div>
					</ListRow>
					<ListRow title='Two-factor authentication' description='Add a layer of security to login' isLabel>
						<Switch
							checked={is2faEnabledQ.data}
							onCheckedChange={(checked) =>
								navigate({
									search: addLinkSearchParams({dialog: checked ? '2fa-enable' : '2fa-disable'}),
								})
							}
						/>
					</ListRow>
					<ListRow title='Remote Tor access' description='Access Umbrel from anywhere using a Tor browser' isLabel>
						<Switch
							checked={tor.enabled}
							onCheckedChange={(checked) =>
								checked
									? navigate({
											search: addLinkSearchParams({dialog: 'confirm-enable-tor'}),
									  })
									: tor.setEnabled(false)
							}
						/>
					</ListRow>
					{isUmbrelHome && (
						<ListRow title='Migration Assistant' description='Move your data from Raspberry Pi to Umbrel Home' isLabel>
							{/* We could use an IconLinkButton but then the `isLabel` from `ListRow` wouldn't work */}
							<IconButton
								icon={RiExpandRightFill}
								onClick={() =>
									navigate({
										search: addLinkSearchParams({dialog: 'migration-assistant'}),
									})
								}
							>
								Migrate
							</IconButton>
						</ListRow>
					)}
					{/* TODO: make clicking trigger the dropdown */}
					<ListRow title='Language' description='Select preferred language '>
						<LanguageDropdown />
					</ListRow>
					<ListRow title='App store' description='App store settings & app updates' isLabel>
						<IconButton
							icon={RiEqualizerLine}
							onClick={() =>
								navigate({
									search: addLinkSearchParams({dialog: 'app-store-preferences'}),
								})
							}
						>
							Preferences
						</IconButton>
					</ListRow>
					<ListRow title='Troubleshoot' description='View logs for troubleshooting' isLabel>
						<IconButton
							icon={TbTool}
							onClick={() =>
								navigate({
									search: addLinkSearchParams({dialog: 'troubleshoot'}),
								})
							}
						>
							Troubleshoot
						</IconButton>
					</ListRow>
					<ListRow title='Device Information' description='View logs for troubleshooting umbrelOS or an app' isLabel>
						<IconButton
							icon={TbServer}
							onClick={() =>
								navigate({
									search: addLinkSearchParams({dialog: 'device-info'}),
								})
							}
						>
							View Info
						</IconButton>
					</ListRow>
					<SoftwareUpdateListRow />
					<ListRow title='Factory Reset' description='Delete all data, and reset your device completely' isLabel>
						<IconButton
							text='destructive'
							icon={TbRotate2}
							onClick={() =>
								navigate({
									search: addLinkSearchParams({dialog: 'factory-reset'}),
								})
							}
						>
							Reset
						</IconButton>
					</ListRow>
				</Card>
				<ContactSupportLink className='lg:hidden' />
			</div>
		</div>
	)
}

function duration(seconds?: number) {
	if (seconds === undefined) return UNKNOWN()
	return formatDistance(0, seconds * 1000, {includeSeconds: true})
}
