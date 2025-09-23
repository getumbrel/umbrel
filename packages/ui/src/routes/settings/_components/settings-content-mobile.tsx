import {
	Tb2Fa,
	TbArrowBigRightLines,
	TbCircleArrowUp,
	TbHistory,
	TbLanguage,
	TbPhoto,
	TbServer,
	TbSettingsMinus,
	TbTool,
	TbUser,
	TbWifi,
} from 'react-icons/tb'
import {Link, useNavigate} from 'react-router-dom'

// import {useNavigate} from 'react-router-dom'

import {TorIcon2} from '@/assets/tor-icon2'
import {ButtonLink} from '@/components/ui/button-link'
import {Card} from '@/components/ui/card'
import {SETTINGS_SYSTEM_CARDS_ID, UNKNOWN} from '@/constants'
import {useCpuTemperature} from '@/hooks/use-cpu-temperature'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useQueryParams} from '@/hooks/use-query-params'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {DesktopPreviewConnected} from '@/modules/desktop/desktop-preview-basic'
import {WifiListRowConnectedDescription} from '@/modules/wifi/wifi-list-row-connected-description'
import {SettingsSummary} from '@/routes/settings/_components/settings-summary'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {firstNameFromFullName} from '@/utils/misc'

import {CpuCardContent} from './cpu-card-content'
import {CpuTemperatureCardContent} from './cpu-temperature-card-content'
import {ListRowMobile} from './list-row'
import {MemoryCardContent} from './memory-card-content'
import {ContactSupportLink} from './shared'
import {StorageCardContent} from './storage-card-content'

export function SettingsContentMobile() {
	const {addLinkSearchParams} = useQueryParams()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const cpuTemperature = useCpuTemperature()
	const deviceInfo = useDeviceInfo()
	const wifiQ = trpcReact.wifi.connected.useQuery()
	const tor = useTorEnabled()
	// const isUmbrelHomeQ = trpcReact.migration.isUmbrelHome.useQuery()
	// const isUmbrelHome = !!isUmbrelHomeQ.data

	if (!userQ.data) {
		return null
	}

	return (
		<div className='flex flex-col gap-5 animate-in fade-in'>
			<div className='flex items-center justify-center'>
				<DesktopPreviewFrame>
					<DesktopPreviewConnected />
				</DesktopPreviewFrame>
			</div>

			<div className='grid max-md:gap-5 md:grid-cols-2'>
				<div className='flex items-center gap-[5px] px-2.5 md:order-last'>
					<ButtonLink to={{search: addLinkSearchParams({dialog: 'logout'})}} size='md-squared' className='flex-grow'>
						{t('logout')}
					</ButtonLink>
					<ButtonLink to={{search: addLinkSearchParams({dialog: 'restart'})}} size='md-squared' className='flex-grow'>
						{t('restart')}
					</ButtonLink>
					<ButtonLink
						to={{
							search: addLinkSearchParams({dialog: 'shutdown'}),
						}}
						size='md-squared'
						text='destructive'
						className='flex-grow'
					>
						{t('shut-down')}
					</ButtonLink>
				</div>

				<div className='mx-2.5'>
					<h2 className='text-24 font-bold leading-none -tracking-4'>
						{userQ.data?.name && `${firstNameFromFullName(userQ.data?.name)}’s`}{' '}
						<span className='opacity-40'>{t('umbrel')}</span>
					</h2>
					<div className='pt-5' />
					<SettingsSummary />
				</div>
			</div>

			{/* --- */}
			<div className='grid grid-cols-2 gap-2'>
				<Link
					to={{
						search: addLinkSearchParams({dialog: 'live-usage', tab: 'storage'}),
					}}
				>
					<Card>
						<StorageCardContent />
					</Card>
				</Link>

				<Link
					to={{
						search: addLinkSearchParams({dialog: 'live-usage', tab: 'memory'}),
					}}
				>
					{/* Set id on the second card because we wanna scroll to see them all */}
					<Card id={SETTINGS_SYSTEM_CARDS_ID}>
						<MemoryCardContent />
					</Card>
				</Link>

				<Link
					to={{
						search: addLinkSearchParams({dialog: 'live-usage', tab: 'cpu'}),
					}}
				>
					<Card>
						<CpuCardContent />
					</Card>
				</Link>

				<Card>
					<CpuTemperatureCardContent
						warning={cpuTemperature.warning}
						temperatureInCelcius={cpuTemperature.temperature}
					/>
				</Card>
			</div>

			<div className='umbrel-divide-y rounded-12 bg-white/5 p-1'>
				<ListRowMobile
					icon={TbUser}
					title={t('account')}
					description={t('account-description')}
					onClick={() => navigate('account/change-name')}
				/>
				<ListRowMobile
					icon={TbPhoto}
					title={t('wallpaper')}
					description={t('wallpaper-description')}
					onClick={() => navigate('wallpaper')}
				/>
				<ListRowMobile
					icon={TbWifi}
					title={t('wifi')}
					description={
						wifiQ.data?.status === 'connected' ? (
							<WifiListRowConnectedDescription network={wifiQ.data} />
						) : (
							t('wifi-description')
						)
					}
					onClick={() => navigate('wifi')}
				/>
				<ListRowMobile
					icon={Tb2Fa}
					title={t('2fa')}
					description={t('2fa-description')}
					onClick={() => navigate('2fa')}
				/>
				<ListRowMobile
					icon={TorIcon2}
					title={
						<span className='flex items-center gap-2' onClick={() => navigate('tor')}>
							{t('remote-tor-access')} {tor.enabled && <TorPulse />}
						</span>
					}
					description={t('tor-description')}
					onClick={() => navigate('tor')}
				/>
				<ListRowMobile
					icon={TbHistory}
					title={t('backups')}
					description={t('backups-description')}
					onClick={() => navigate('backups')}
				/>
				<ListRowMobile
					icon={TbArrowBigRightLines}
					title={t('migration-assistant')}
					description={t('migration-assistant-description')}
					onClick={() => navigate('migration-assistant')}
				/>
				<ListRowMobile
					icon={TbLanguage}
					title={t('language')}
					description={t('language-description')}
					onClick={() => navigate('language')}
				/>
				{/* <ListRowMobile
					icon={TbShoppingBag}
					title={t('app-store.title')}
					description={t('app-store.description')}
					onClick={() => navigate(linkToDialog('app-store-preferences'))}
				/> */}
				<ListRowMobile
					icon={TbTool}
					title={t('troubleshoot')}
					description={t('troubleshoot-description')}
					onClick={() => navigate('troubleshoot')}
				/>
				<ListRowMobile
					icon={TbServer}
					title={t('device-info')}
					description={t('device-info-description', {
						model: deviceInfo.data?.modelNumber ?? UNKNOWN(),
						serial: deviceInfo.data?.serialNumber ?? UNKNOWN(),
					})}
					onClick={() => navigate('device-info')}
				/>
				<ListRowMobile
					icon={TbSettingsMinus}
					title={t('advanced-settings')}
					description={t('advanced-settings-description')}
					onClick={() => navigate('advanced')}
				/>
				<ListRowMobile
					icon={TbCircleArrowUp}
					title={t('software-update.title')}
					description={t('check-for-latest-version')}
					onClick={() => navigate('software-update')}
				/>
			</div>
			<ContactSupportLink />
		</div>
	)
}

const TorPulse = () => (
	<div className='inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-[#299E16] ring-3 ring-[#16FF001A]/10' />
)
