import {useEffect, useState} from 'react'
import {
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
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {LOADING_DASH, UNKNOWN} from '@/constants'
import {useCpuTemp} from '@/hooks/use-cpu-temp'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useLanguage} from '@/hooks/use-language'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {DesktopPreview, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {DropdownMenu} from '@/shadcn-components/ui/dropdown-menu'
import {Switch} from '@/shadcn-components/ui/switch'
import {trpcReact} from '@/trpc/trpc'
import {duration} from '@/utils/date-time'
import {useLinkToDialog} from '@/utils/dialog'
import {maybeT, t} from '@/utils/i18n'

import {LanguageDropdownContent, LanguageDropdownTrigger} from './language-dropdown'
import {ListRow} from './list-row'
import {MemoryCard} from './memory-card'
import {ContactSupportLink} from './shared'
import {SoftwareUpdateListRow} from './software-update-list-row'
import {StorageCard} from './storage-card'
import {TempStatCardContent} from './temp-stat-card-content'
import {WallpaperPicker} from './wallpaper-picker'

export function SettingsContent() {
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const [languageCode] = useLanguage()

	const tor = useTorEnabled()
	const deviceInfo = useDeviceInfo()
	const cpuTemp = useCpuTemp()

	const [langOpen, setLangOpen] = useState(false)

	const [userQ, uptimeQ, is2faEnabledQ, osVersionQ] = trpcReact.useQueries((t) => [
		t.user.get(),
		t.system.uptime(),
		t.user.is2faEnabled(),
		t.system.version(),
	])

	// Scroll to hash
	useEffect(() => {
		if (location.hash) {
			const el = document.querySelector(location.hash)
			if (el) {
				el.scrollIntoView({behavior: 'instant', block: 'center'})
			}
		}
	}, [])

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
						<h2 className='text-24 font-bold leading-none -tracking-4'>
							{/* TODO: interpolate here */}
							{userQ.data?.name ?? UNKNOWN()}’s <span className='opacity-40'>{t('umbrel')}</span>
						</h2>
						<div className='pt-5' />
						<dl className='grid grid-cols-2 gap-x-5 gap-y-2 text-14 leading-none -tracking-2'>
							<dt className='opacity-40'>{t('running-on')}</dt>
							<dd>{maybeT(deviceInfo.data?.umbrelHostEnvironment)}</dd>
							<dt className='opacity-40'>{t('umbrelos-version')}</dt>
							<dd>{osVersionQ.isLoading ? LOADING_DASH : osVersionQ.data ?? UNKNOWN()}</dd>
							<dt className='opacity-40'>{t('uptime')}</dt>
							<dd>{uptimeQ.isLoading ? LOADING_DASH : duration(uptimeQ.data, languageCode)}</dd>
						</dl>
					</div>
					<div className='flex w-full flex-col items-stretch gap-2.5 md:w-auto md:flex-row'>
						<IconButtonLink to={linkToDialog('logout')} size='xl' icon={RiLogoutCircleRLine}>
							{t('logout')}
						</IconButtonLink>
						<IconButtonLink to={linkToDialog('restart')} size='xl' icon={RiRestartLine}>
							{t('restart')}
						</IconButtonLink>
						<IconButtonLink to={linkToDialog('shutdown')} size='xl' text='destructive' icon={RiShutDownLine}>
							{t('shut-down')}
						</IconButtonLink>
					</div>
				</Card>
				<div className='flex flex-col gap-3'>
					<StorageCard />
					{/* Choosing middle card because we wanna scroll to center to likely see them all */}
					<MemoryCard />
					<Card>
						<TempStatCardContent tempInCelcius={cpuTemp.temp} />
					</Card>
					<div className='mx-auto'>
						<IconButtonLink icon={RiPulseLine} to={linkToDialog('live-usage')}>
							{t('open-live-usage')}
						</IconButtonLink>
					</div>
					<div className='flex-1' />
					<ContactSupportLink className='max-lg:hidden' />
				</div>
				<Card className='umbrel-divide-y overflow-hidden !py-2'>
					<ListRow title={t('account')} description={t('account-description')}>
						<div className='flex flex-wrap gap-2'>
							<IconButtonLink to={linkToDialog('change-name')} icon={RiUserLine}>
								{t('change-name')}
							</IconButtonLink>
							<IconButtonLink to={linkToDialog('change-password')} icon={RiKeyLine}>
								{t('change-password')}
							</IconButtonLink>
						</div>
					</ListRow>
					<ListRow title={t('wallpaper')} description={t('wallpaper-description')}>
						{/* -mx-2 so that when last item is active, it right aligns with other list row buttons, and first item aligns on mobile when picker wrapped down */}
						{/* w-full to prevent overflow issues */}
						<div className='-mx-2 max-w-full'>
							<WallpaperPicker />
						</div>
					</ListRow>
					<ListRow title={t('2fa-long')} description={t('2fa-description')} isLabel disabled={is2faEnabledQ.isLoading}>
						<Switch
							checked={is2faEnabledQ.data}
							onCheckedChange={() => navigate(linkToDialog(is2faEnabledQ.data ? '2fa-disable' : '2fa-enable'))}
						/>
					</ListRow>
					<ListRow title={t('tor-long')} description={t('tor-description')} isLabel>
						<Switch
							checked={tor.enabled}
							onCheckedChange={(checked) => (checked ? navigate(linkToDialog('tor')) : tor.setEnabled(false))}
						/>
					</ListRow>
					<ListRow title={t('migration-assistant')} description={t('migration-assistant-description')} isLabel>
						{/* We could use an IconButtonLink but then the `isLabel` from `ListRow` wouldn't work */}
						<IconButton icon={RiExpandRightFill} onClick={() => navigate(linkToDialog('migration-assistant'))}>
							{t('migrate')}
						</IconButton>
					</ListRow>
					<ListRow
						title={t('language')}
						description={t('language-description')}
						isLabel
						onClick={() => setLangOpen(true)}
					>
						<DropdownMenu open={langOpen} onOpenChange={setLangOpen}>
							<LanguageDropdownTrigger />
							<LanguageDropdownContent />
						</DropdownMenu>
					</ListRow>
					{/* <ListRow title={t('app-store.title')} description={t('app-store.description')} isLabel>
						<IconButton icon={RiEqualizerLine} onClick={() => navigate(linkToDialog('app-store-preferences'))}>
							{t('preferences')}
						</IconButton>
					</ListRow> */}
					<ListRow title={t('troubleshoot')} description={t('troubleshoot-description')} isLabel>
						<IconButton icon={TbTool} onClick={() => navigate(linkToDialog('troubleshoot'))}>
							{t('troubleshoot')}
						</IconButton>
					</ListRow>
					<ListRow title={t('device-info-long')} description={t('device-info-description')} isLabel>
						<IconButton icon={TbServer} onClick={() => navigate(linkToDialog('device-info'))}>
							{t('device-info.view-info')}
						</IconButton>
					</ListRow>
					<SoftwareUpdateListRow />
					<ListRow title={t('factory-reset')} description={t('factory-reset.desc')} isLabel>
						<IconButton text='destructive' icon={TbRotate2} onClick={() => navigate('/factory-reset')}>
							{t('factory-reset.reset')}
						</IconButton>
					</ListRow>
				</Card>
				<ContactSupportLink className='lg:hidden' />
			</div>
		</div>
	)
}
