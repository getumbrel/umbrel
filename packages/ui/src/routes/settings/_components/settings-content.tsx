import BigNumber from 'bignumber.js'
import {Globe} from 'lucide-react'
import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'
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
import {useLocalStorage} from 'react-use'

import {ChevronDown} from '@/assets/chevron-down'
import {Card} from '@/components/ui/card'
import {IconButton} from '@/components/ui/icon-button'
import {IconLinkButton} from '@/components/ui/icon-link-button'
import {deviceMap, SETTINGS_SYSTEM_CARDS_ID, UNKNOWN} from '@/constants'
import {useQueryParams} from '@/hooks/use-query-params'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {DesktopPreview, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Switch} from '@/shadcn-components/ui/switch'
import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {isDiskFull, isDiskLow, isMemoryLow} from '@/utils/system'

import {ListRow} from './list-row'
import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass, ContactSupportLink} from './shared'
import {SoftwareUpdateListRow} from './software-update-list-row'
import {TempStatCardContent} from './temp-stat-card-content'
import {WallpaperPicker} from './wallpaper-picker'

export function SettingsContent() {
	const {addLinkSearchParams} = useQueryParams()
	const navigate = useNavigate()
	const tor = useTorEnabled()

	const [userQ, deviceInfoQ, cpuTempQ, diskQ, memoryQ, isUmbrelHomeQ, is2faEnabledQ, osVersionQ] = trpcReact.useQueries(
		(t) => [
			t.user.get(),
			t.system.deviceInfo(),
			t.system.cpuTemperature(),
			t.system.diskUsage(),
			t.system.memoryUsage(),
			t.migration.isUmbrelHome(),
			t.user.is2faEnabled(),
			t.system.osVersion(),
		],
	)

	const isUmbrelHome = !!isUmbrelHomeQ.data

	// TODO: also wanna check CPU temp
	const isLoading =
		userQ.isLoading ||
		deviceInfoQ.isLoading ||
		diskQ.isLoading ||
		memoryQ.isLoading ||
		is2faEnabledQ.isLoading ||
		osVersionQ.isLoading

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
					<Card>
						<ProgressStatCardContent
							title='Storage'
							value={maybePrettyBytes(diskQ.data?.used)}
							valueSub={`/ ${maybePrettyBytes(diskQ.data?.size)}`}
							secondaryValue={`${maybePrettyBytes(diskQ.data?.available)} left`}
							progress={BigNumber(diskQ.data?.used ?? 0 * 100)
								.dividedBy(diskQ.data?.size ?? 0)
								.toNumber()}
							afterChildren={
								<>
									{isDiskLow(diskQ.data?.available ?? 0) && <span className={cardErrorClass}>Disk is low.</span>}
									{isDiskFull(diskQ.data?.available ?? 0) && <span className={cardErrorClass}>Disk is full.</span>}
								</>
							}
						/>
					</Card>
					{/* Choosing middle card because we wanna scroll to center to likely see them all */}
					<Card id={SETTINGS_SYSTEM_CARDS_ID}>
						<ProgressStatCardContent
							title='Memory'
							value={maybePrettyBytes(memoryQ.data?.used)}
							valueSub={`/ ${maybePrettyBytes(memoryQ.data?.size)}`}
							secondaryValue={`${maybePrettyBytes(memoryQ.data?.available)} left`}
							progress={BigNumber(memoryQ.data?.used ?? 0 * 100)
								.dividedBy(memoryQ.data?.size ?? 0)
								.toNumber()}
							afterChildren={
								memoryQ.data && isMemoryLow(memoryQ.data) && <span className={cardErrorClass}>Memory is low.</span>
							}
						/>
					</Card>
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
const languages = [
	{name: 'English', code: 'en'},
	{name: 'Français', code: 'fr'},
	{name: 'العربية', code: 'ar'},
]

function LanguageDropdown() {
	const {i18n} = useTranslation()
	const [activeCode, setActiveCode] = useLocalStorage('i18nextLng', 'en', {
		raw: true,
	})

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton icon={Globe} id='language'>
					{languages.find(({code}) => code === activeCode)?.name}
					<ChevronDown />
				</IconButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end'>
				{languages.map(({code, name}) => (
					<DropdownMenuCheckboxItem
						key={code}
						checked={activeCode === code}
						onSelect={() => {
							setActiveCode(code)
							i18n.changeLanguage(code)
						}}
					>
						{name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
