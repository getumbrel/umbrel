import {
	Tb2Fa,
	TbArrowBigRightLines,
	TbCircleArrowUp,
	TbColumns3,
	TbHistory,
	TbLanguage,
	TbPhoto,
	TbServer,
	TbSettingsMinus,
	TbShare,
	TbTool,
	TbUser,
	TbWifi,
} from 'react-icons/tb'
import {Link, useNavigate} from 'react-router-dom'

// import {useNavigate} from 'react-router-dom'

import {ButtonLink} from '@/components/ui/button-link'
import {Card} from '@/components/ui/card'
import {SETTINGS_SYSTEM_CARDS_ID, UNKNOWN} from '@/constants'
import {getDeviceHealth} from '@/features/storage/hooks/use-storage'
import {useCpuTemperature} from '@/hooks/use-cpu-temperature'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {useIsUmbrelPro} from '@/hooks/use-is-umbrel-pro'
import {useQueryParams} from '@/hooks/use-query-params'
import {DesktopPreviewConnected, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
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
	const {isUmbrelPro} = useIsUmbrelPro()
	const {deviceName} = useIsHomeOrPro()
	// Storage queries only run on Umbrel Pro to avoid unnecessary API calls on other devices
	const raidStatusQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {enabled: isUmbrelPro})
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {enabled: isUmbrelPro})
	// const isUmbrelHomeQ = trpcReact.migration.isUmbrelHome.useQuery()
	// const isUmbrelHome = !!isUmbrelHomeQ.data

	// Check if there's a RAID issue that needs attention
	const hasRaidIssue = raidStatusQ.data?.exists && raidStatusQ.data?.status && raidStatusQ.data?.status !== 'ONLINE'

	// Check if any SSD has health issues
	const hasHealthIssue = devicesQ.data?.some((device) => getDeviceHealth(device).hasWarning)

	// Show indicator if any storage issue exists
	// Note: Storage Manager row only renders on Umbrel Pro, so this indicator is Pro-only
	const hasStorageIssue = hasRaidIssue || hasHealthIssue

	if (!userQ.data) {
		return null
	}

	return (
		<div className='flex animate-in flex-col gap-5 fade-in'>
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
					<h2 className='text-24 leading-none font-bold -tracking-4'>
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
					icon={TbShare}
					title={t('settings.file-sharing')}
					description={t('settings.file-sharing.description')}
					onClick={() => navigate('file-sharing')}
				/>
				{isUmbrelPro && (
					<ListRowMobile
						icon={TbColumns3}
						title={
							<span className='flex items-center gap-1.5'>
								{t('storage-manager')}
								{hasStorageIssue && (
									<div className='relative h-2 w-2'>
										<span className='absolute inset-0 rounded-full bg-[#FF3434]' />
										<span className='absolute inset-0 animate-ping rounded-full bg-[#FF3434] opacity-75' />
									</div>
								)}
							</span>
						}
						description={t('storage-manager.description')}
						onClick={() => navigate('storage')}
					/>
				)}
				<ListRowMobile
					icon={TbHistory}
					title={t('backups')}
					description={t('backups-description')}
					onClick={() => navigate('backups')}
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
					icon={TbArrowBigRightLines}
					title={t('migration-assistant')}
					description={t('migration-assistant-description', {deviceName})}
					onClick={() => navigate('migration-assistant')}
				/>
				<ListRowMobile
					icon={TbLanguage}
					title={t('language')}
					description={t('language-description')}
					onClick={() => navigate('language')}
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
