import {
	Tb2Fa,
	TbActivityHeartbeat,
	TbArrowBigRightLines,
	TbCircleArrowUp,
	TbLanguage,
	TbPhoto,
	TbRotate2,
	TbServer,
	TbTool,
	TbUser,
} from 'react-icons/tb'
import {Link, useNavigate} from 'react-router-dom'

// import {useNavigate} from 'react-router-dom'

import {TorIcon2} from '@/assets/tor-icon2'
import {ButtonLink} from '@/components/ui/button-link'
import {Card, cardClass} from '@/components/ui/card'
import {LOADING_DASH, SETTINGS_SYSTEM_CARDS_ID, UNKNOWN} from '@/constants'
import {useCpuTemp} from '@/hooks/use-cpu-temp'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useLanguage} from '@/hooks/use-language'
import {useQueryParams} from '@/hooks/use-query-params'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {DesktopPreview, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {duration} from '@/utils/date-time'
import {maybeT, t} from '@/utils/i18n'

import {CpuTempCardContent} from './cpu-temp-card-content'
import {ListRowMobile} from './list-row'
import {MemoryCardContent} from './memory-card-content'
import {ContactSupportLink} from './shared'
import {StorageCardContent} from './storage-card-content'

export function SettingsContentMobile() {
	const [languageCode] = useLanguage()
	const {addLinkSearchParams} = useQueryParams()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const cpuTemp = useCpuTemp()
	const deviceInfo = useDeviceInfo()
	const osVersionQ = trpcReact.system.version.useQuery()
	const uptimeQ = trpcReact.system.uptime.useQuery()
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
					<DesktopPreview />
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
						{userQ.data.name}’s <span className='opacity-40'>{t('umbrel')}</span>
					</h2>
					<div className='pt-5' />
					<dl className='grid grid-cols-2 gap-x-5 gap-y-2 text-14 leading-none -tracking-2'>
						<dt className='opacity-40'>{t('running-on')}</dt>
						<dd>{deviceInfo.data?.device || LOADING_DASH}</dd>
						<dt className='opacity-40'>{t('umbrelos-version')}</dt>
						<dd>{osVersionQ.data ?? LOADING_DASH}</dd>
						<dt className='opacity-40'>{t('uptime')}</dt>
						<dd>{uptimeQ.isLoading ? LOADING_DASH : duration(uptimeQ.data, languageCode)}</dd>
						{/* TODO: add tor hidden service */}
						{/* But for now, assume mobile users don't have tor */}
					</dl>
				</div>
			</div>

			{/* --- */}
			<div className='grid grid-cols-2 gap-2'>
				{/* Choosing first card because we wanna scroll to see them all */}
				<Card>
					<StorageCardContent />
				</Card>
				<Card id={SETTINGS_SYSTEM_CARDS_ID}>
					<MemoryCardContent />
				</Card>
				<Card>
					<CpuTempCardContent cpuType={cpuTemp.cpuType} tempInCelcius={cpuTemp.temp} />
				</Card>
				<Link
					className={cn(cardClass, 'flex flex-col justify-between')}
					to={{
						search: addLinkSearchParams({dialog: 'live-usage'}),
					}}
				>
					<TbActivityHeartbeat className='h-5 w-5 [&>*]:stroke-[1.5px]' />
					<span className='text-12 font-medium leading-inter-trimmed'>{t('open-live-usage')}</span>
				</Link>
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
					icon={Tb2Fa}
					title={t('2fa-long')}
					description={t('2fa-description')}
					onClick={() => navigate('2fa')}
				/>
				<ListRowMobile
					icon={TorIcon2}
					title={
						<span className='flex items-center gap-2' onClick={() => navigate('tor')}>
							{t('tor-long')} {tor.enabled && <TorPulse />}
						</span>
					}
					description={t('tor-description')}
					onClick={() => navigate('tor')}
				/>
				<ListRowMobile
					icon={TbArrowBigRightLines}
					title={t('migration-assistant')}
					description={t('migration-assistant-description')}
					onClick={() => navigate('migration-assistant')}
				/>
				{/* TODO: Uncomment and enable after fixing translations  */}
				{/* <ListRowMobile
					icon={TbLanguage}
					title={t('language')}
					description={t('language-description')}
					onClick={() => navigate('language')}
				/> */}
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
					title={t('device-info-short')}
					description={t('device-info-detail-description', {
						model: deviceInfo.data?.modelNumber ?? UNKNOWN(),
						serial: deviceInfo.data?.serialNumber ?? UNKNOWN(),
					})}
					onClick={() => navigate('device-info')}
				/>
				<ListRowMobile
					icon={TbCircleArrowUp}
					title={t('software-update.title')}
					description={t('check-for-latest-version')}
					onClick={() => navigate('software-update')}
				/>
				{/* <ListRowMobile
					icon={TbRotate2}
					title={t('factory-reset')}
					description={t('factory-reset.desc')}
					onClick={() => navigate('/factory-reset')}
				/> */}
			</div>

			<ContactSupportLink />
		</div>
	)
}

const TorPulse = () => (
	<div className='inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-[#299E16] ring-3 ring-[#16FF001A]/10' />
)
