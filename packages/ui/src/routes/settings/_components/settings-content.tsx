import BigNumber from 'bignumber.js'
import {Globe} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {
	RiArrowUpCircleFill,
	RiCheckboxCircleFill,
	RiEqualizerLine,
	RiExpandRightFill,
	RiKeyLine,
	RiLogoutCircleRLine,
	RiPulseLine,
	RiRefreshLine,
	RiRestartLine,
	RiShutDownLine,
	RiUserLine,
} from 'react-icons/ri'
import {TbTool} from 'react-icons/tb'
import {Link, useNavigate} from 'react-router-dom'
import {useLocalStorage} from 'react-use'

import {ChevronDown} from '@/assets/chevron-down'
import {Card} from '@/components/ui/card'
import {Icon} from '@/components/ui/icon'
import {IconButton} from '@/components/ui/icon-button'
import {IconLinkButton} from '@/components/ui/icon-link-button'
import {links} from '@/constants/links'
import {useQueryParams} from '@/hooks/use-query-params'
import {DesktopPreview, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {Button} from '@/shadcn-components/ui/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Switch} from '@/shadcn-components/ui/switch'
import {trpcReact} from '@/trpc/trpc'
import {linkClass} from '@/utils/element-classes'
import {fixmeHandler} from '@/utils/misc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'

import {ListRow} from './list-row'
import {ProgressStatCardContent} from './progress-card-content'
import {TempStatCardContent} from './temp-stat-card-content'
import {WallpaperPicker} from './wallpaper-picker'

export function SettingsContent() {
	const {addLinkSearchParams} = useQueryParams()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const cpuTempQ = trpcReact.system.cpuTemperature.useQuery()
	const diskQ = trpcReact.system.diskUsage.useQuery()
	const memoryQ = trpcReact.system.memoryUsage.useQuery()
	const isUmbrelHomeQ = trpcReact.migration.isUmbrelHome.useQuery()
	const isUmbrelHome = !!isUmbrelHomeQ.data
	const is2faEnabledQ = trpcReact.user.is2faEnabled.useQuery()

	if (!userQ.data) {
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
						/>
					</Card>
					<Card>
						<ProgressStatCardContent
							title='Memory'
							value={maybePrettyBytes(memoryQ.data?.used)}
							valueSub={`/ ${maybePrettyBytes(memoryQ.data?.size)}`}
							secondaryValue={`${maybePrettyBytes(memoryQ.data?.available)} left`}
							progress={BigNumber(memoryQ.data?.used ?? 0 * 100)
								.dividedBy(memoryQ.data?.size ?? 0)
								.toNumber()}
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
					<div className='mx-auto text-12 font-normal text-white/70'>
						Need help?{' '}
						<Link className={linkClass} to={links.support}>
							Contact support.
						</Link>
					</div>
				</div>
				<Card className='umbrel-divide-y overflow-hidden py-2'>
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
							<WallpaperPicker />
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
						<Switch onCheckedChange={fixmeHandler} />
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
					<SoftwareUpdateListRow />
				</Card>
			</div>
		</div>
	)
}
function SoftwareUpdateListRow() {
	const [checking, setChecking] = useState(false)

	const currentVersion = '0.5.4'
	const latestVersion = '1.2'

	const atLatest = (
		<span className='flex items-center gap-1'>
			<Icon component={RiCheckboxCircleFill} className='text-success' />
			You are on the latest version
		</span>
	)

	const updateAvailable = (
		<span className='flex items-center gap-1'>
			<Icon component={RiArrowUpCircleFill} className='text-brand' />
			New version {latestVersion} is available
		</span>
	)

	return (
		<>
			<ListRow title={`umbrelOS ${currentVersion}`} description={atLatest} isLabel>
				<Button onClick={() => setChecking((c) => !c)}>
					<Icon component={RiRefreshLine} className={checking ? 'animate-spin' : undefined} />
					Check for updates
				</Button>
			</ListRow>
			<ListRow title={`umbrelOS ${currentVersion}`} description={updateAvailable} isLabel>
				<Button variant='primary' onClick={() => setChecking((c) => !c)}>
					<Icon component={RiRefreshLine} className={checking ? 'animate-spin' : undefined} />
					Update now
				</Button>
			</ListRow>
		</>
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
