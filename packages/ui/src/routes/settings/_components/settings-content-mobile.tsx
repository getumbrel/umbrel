import {ChevronRight} from 'lucide-react'
import {motion, useReducedMotion} from 'motion/react'
import {ComponentType, Fragment, ReactNode, useMemo, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {PiCircuitryBold, PiHardDriveFill, PiPulseBold, PiThermometerSimpleBold} from 'react-icons/pi'
import {Link, useNavigate} from 'react-router-dom'
import {useWindowSize} from 'react-use'

import {FadeScroller} from '@/components/fade-scroller'
import {BetaPill} from '@/components/ui/beta-pill'
import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {Card} from '@/components/ui/card'
import {SearchField} from '@/components/ui/edge-controls'
import {Separator} from '@/components/ui/separator'
import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {getDeviceHealth} from '@/features/storage/hooks/use-storage'
import {useCpuTemperature} from '@/hooks/use-cpu-temperature'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {DesktopPreviewConnected, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {PANES_MIN_W} from '@/modules/desktop/home-fit'
import {WifiListRowConnectedDescription} from '@/modules/wifi/wifi-list-row-connected-description'
import {useWallpaper, WallpaperAvifSource} from '@/providers/wallpaper'
import {SettingsSummary} from '@/routes/settings/_components/settings-summary'
import {trpcReact} from '@/trpc/trpc'
import {focusRingClass} from '@/utils/element-classes'
import {firstNameFromFullName} from '@/utils/misc'

import {CpuCardContent} from './cpu-card-content'
import {CpuTemperatureCardContent} from './cpu-temperature-card-content'
import {ListRowMobile, ListRowSwitchIndicator} from './list-row'
import {MemoryCardContent} from './memory-card-content'
import {createSettingsCatalog, getSettingsPage, SettingsPageItem} from './settings-catalog'
import {SettingsItemsGroup} from './settings-page-controls'
import {useSettingsFilterLabels} from './settings-taxonomy'
import {SettingsAccountAvatar, settingsPanesGridClass, settingsSidePaneClass} from './shared'
import {StorageCardContent} from './storage-card-content'

const statCardClass = 'settings-edge-material h-full min-h-[104px] !rounded-24 !p-4 panes:min-h-0 panes:!p-5'
const mobileActionButtonClass = 'settings-edge-material h-9 flex-1 rounded-full px-2 text-12 whitespace-nowrap'

export function SettingsContentMobile({isMember = false}: {isMember?: boolean}) {
	const {t} = useTranslation()
	const filterLabels = useSettingsFilterLabels()
	const {addLinkSearchParams} = useQueryParams()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const cpuTemperature = useCpuTemperature({enabled: !isMember})
	const wifiSupportedQ = trpcReact.wifi.supported.useQuery(undefined, {enabled: !isMember})
	const wifiQ = trpcReact.wifi.connected.useQuery(undefined, {enabled: !isMember && wifiSupportedQ.data === true})
	const is2faEnabledQ = trpcReact.user.is2faEnabled.useQuery(undefined, {enabled: isMember})
	const {deviceName} = useIsHomeOrPro()
	const {wallpaper} = useWallpaper()
	const raidStatusQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {enabled: !isMember})
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		enabled: !isMember,
	})

	const [searchQuery, setSearchQuery] = useState('')

	// Two to a row on a phone, with icons. In the side pane that would cut off
	// their labels, so they stack like the desktop sidebar's instead.
	const inPanes = useWindowSize().width >= PANES_MIN_W
	const statIcon = (icon: ComponentType<{className?: string}>) => (inPanes ? undefined : <MobileStatIcon icon={icon} />)

	const hasRaidIssue = raidStatusQ.data?.exists && raidStatusQ.data?.status && raidStatusQ.data?.status !== 'ONLINE'
	const hasHealthIssue = devicesQ.data?.some((device) => getDeviceHealth(device).hasWarning)
	const hasStorageIssue = hasRaidIssue || hasHealthIssue
	// SSD wording only when the machine is known to be SSD-only - HDD, mixed, and not-yet-loaded
	// setups get generic drive wording (correct for any device type)
	const storageIssueLabel = devicesQ.data?.every((device) => device.type === 'ssd')
		? t('storage-manager.health.title')
		: t('storage-manager.health.title-drive')
	const ownerFirstName = userQ.data?.name ? firstNameFromFullName(userQ.data.name) : ''
	const settingsCatalog = useMemo(
		() =>
			createSettingsCatalog(t, {
				deviceName,
				isMember,
				memberName: userQ.data?.name,
				sambaEnabled: userQ.data?.sambaEnabled === true,
			}),
		[t, deviceName, isMember, userQ.data?.name, userQ.data?.sambaEnabled],
	)
	const settingsPage = useMemo(
		() => getSettingsPage(settingsCatalog, {query: searchQuery, filter: 'all'}),
		[settingsCatalog, searchQuery],
	)

	const desktopPreview = useMemo(
		() => (
			<DesktopPreviewFrame>
				<DesktopPreviewConnected />
			</DesktopPreviewFrame>
		),
		[],
	)

	const renderSettingsItem = (item: SettingsPageItem) => {
		const navigateToItem = () => {
			if (item.id === 'wifi' && wifiSupportedQ.data === false) navigate('/settings/wifi-unsupported')
			else if (item.external) window.open(item.to, '_blank', 'noopener,noreferrer')
			else navigate(item.to)
		}
		let title: ReactNode = item.title
		let description: ReactNode = item.description
		let trailing = <MobileChevron />
		let disabled = false

		if (item.id === '2fa') {
			disabled = is2faEnabledQ.isLoading
			trailing = <ListRowSwitchIndicator checked={is2faEnabledQ.data ?? false} />
		} else if (item.id === 'wifi') {
			disabled = wifiSupportedQ.isLoading || (wifiSupportedQ.data === true && wifiQ.isLoading)
			if (wifiQ.data?.status === 'connected') {
				description = <WifiListRowConnectedDescription network={wifiQ.data} />
			}
		} else if (item.id === 'storage') {
			title = (
				<span className='flex items-center gap-1.5'>
					{item.title}
					{hasStorageIssue && (
						<span className='relative size-2' role='img' aria-label={storageIssueLabel}>
							<span className='absolute inset-0 rounded-full bg-[#FF3434]' />
							<span className='absolute inset-0 animate-ping rounded-full bg-[#FF3434] opacity-75' />
						</span>
					)}
				</span>
			)
		} else if (item.id === 'mcp') {
			title = (
				<span className='flex items-center gap-1.5'>
					{item.title}
					<BetaPill />
				</span>
			)
		}

		return (
			<ListRowMobile
				icon={item.icon}
				title={title}
				description={description}
				disabled={disabled}
				onClick={navigateToItem}
			>
				{trailing}
			</ListRowMobile>
		)
	}

	if (!userQ.data) return null

	return (
		<div className={cn('grid min-w-0 animate-in gap-5 pb-8 fade-in', settingsPanesGridClass)}>
			<FadeScroller direction='y' className={cn('flex min-w-0 flex-col gap-5', settingsSidePaneClass)}>
				<div className='flex flex-col items-center gap-4 px-1'>
					<div className='relative isolate'>
						{wallpaper.id && (
							<picture>
								<WallpaperAvifSource wallpaper={wallpaper} tier='small' />
								<img
									src={wallpaper.url}
									alt=''
									aria-hidden='true'
									className='pointer-events-none absolute top-5 left-1/2 -z-10 h-[154px] w-[260px] -translate-x-1/2 translate-y-5 scale-[0.96] rounded-10 object-cover opacity-65 blur-[22px] saturate-150'
								/>
							</picture>
						)}
						<div className='relative z-10'>{desktopPreview}</div>
						<SettingsAccountAvatar
							name={userQ.data.name}
							userId={userQ.data.userId}
							avatarUrl={userQ.data.avatarUrl}
							controlsVisibility='always'
						/>
					</div>
					{/* Wraps instead of truncating, so a language that puts a long phrase
					    around the name ("Umbrel пользователя …") still shows the name */}
					<h2 className='my-[5px] line-clamp-2 w-full text-center text-24 leading-[30px] font-semibold -tracking-4 text-balance break-words text-white/45'>
						{ownerFirstName ? (
							<Trans
								t={t}
								i18nKey='settings.owner-heading'
								values={{name: ownerFirstName}}
								components={{name: <span className='text-white' />}}
								// The name is the user's own text: escaped, so a "<" in it isn't read as a tag
								tOptions={{interpolation: {escapeValue: true}}}
								shouldUnescape
							/>
						) : (
							t('umbrel')
						)}
					</h2>
				</div>

				<SettingsSummary />

				<div className='flex items-center gap-2'>
					<ButtonLink to={{search: addLinkSearchParams({dialog: 'logout'})}} className={mobileActionButtonClass}>
						{t('logout')}
					</ButtonLink>
					{isMember ? (
						<>
							<Button disabled className={mobileActionButtonClass}>
								{t('restart')}
							</Button>
							<Button disabled text='destructive' className={mobileActionButtonClass}>
								{t('shut-down')}
							</Button>
						</>
					) : (
						<>
							<ButtonLink to={{search: addLinkSearchParams({dialog: 'restart'})}} className={mobileActionButtonClass}>
								{t('restart')}
							</ButtonLink>
							<ButtonLink
								to={{search: addLinkSearchParams({dialog: 'shutdown'})}}
								text='destructive'
								className={mobileActionButtonClass}
							>
								{t('shut-down')}
							</ButtonLink>
						</>
					)}
				</div>
				<Separator />

				{!isMember && (
					<div className='grid grid-cols-2 gap-2.5 panes:grid-cols-1'>
						<Link
							to={{search: addLinkSearchParams({dialog: 'live-usage', 'live-usage-tab': 'storage'})}}
							className={cn('block rounded-24', focusRingClass)}
						>
							<MobileStatCardTap>
								<Card className={statCardClass}>
									<StorageCardContent headerIcon={statIcon(PiHardDriveFill)} />
								</Card>
							</MobileStatCardTap>
						</Link>
						<Link
							to={{search: addLinkSearchParams({dialog: 'live-usage', 'live-usage-tab': 'memory'})}}
							className={cn('block rounded-24', focusRingClass)}
						>
							<MobileStatCardTap>
								<Card id={SETTINGS_SYSTEM_CARDS_ID} className={statCardClass}>
									<MemoryCardContent headerIcon={statIcon(PiCircuitryBold)} />
								</Card>
							</MobileStatCardTap>
						</Link>
						<Link
							to={{search: addLinkSearchParams({dialog: 'live-usage', 'live-usage-tab': 'cpu'})}}
							className={cn('block rounded-24', focusRingClass)}
						>
							<MobileStatCardTap>
								<Card className={statCardClass}>
									<CpuCardContent headerIcon={statIcon(PiPulseBold)} />
								</Card>
							</MobileStatCardTap>
						</Link>
						<Card className={cn('group/temperature-card', statCardClass)}>
							<CpuTemperatureCardContent
								headerIcon={statIcon(PiThermometerSimpleBold)}
								warning={cpuTemperature.warning}
								temperatureInCelcius={cpuTemperature.temperature}
							/>
						</Card>
					</div>
				)}
			</FadeScroller>

			<div className='flex min-w-0 flex-col gap-5'>
				<div data-testid='mobile-settings-controls' className='-mx-3 -mb-4 flex items-center px-3 py-3 panes:pt-0'>
					<SearchField
						value={searchQuery}
						onChange={setSearchQuery}
						label={t('search')}
						className='w-full min-w-0 shrink'
					/>
				</div>

				<div className='flex flex-col gap-4'>
					{settingsPage.categoryIds.map((categoryId) => (
						<SettingsItemsGroup key={categoryId} id={categoryId} label={filterLabels[categoryId]}>
							{settingsPage.itemsByCategory[categoryId].map((item) => (
								<Fragment key={item.id}>{renderSettingsItem(item)}</Fragment>
							))}
						</SettingsItemsGroup>
					))}
					{settingsPage.items.length === 0 && (
						<div className='rounded-24 bg-white/4 px-6 py-12 text-center text-14 text-white/45'>
							{t('settings.no-results', {query: searchQuery})}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

function MobileChevron() {
	return <ChevronRight className='size-4 text-white/45' aria-hidden='true' />
}

// Tap-only feedback: hover states stick on touch, so no whileHover here
function MobileStatCardTap({children}: {children: ReactNode}) {
	const reduceMotion = Boolean(useReducedMotion())
	return (
		<motion.div
			className='h-full will-change-transform'
			whileTap={reduceMotion ? undefined : {scale: 0.96}}
			transition={{type: 'spring', duration: 0.2, bounce: 0.15}}
		>
			{children}
		</motion.div>
	)
}

function MobileStatIcon({icon: Icon}: {icon: ComponentType<{className?: string}>}) {
	return (
		<div
			data-testid='mobile-stat-icon'
			aria-hidden='true'
			className='flex size-5 shrink-0 items-center justify-center text-white'
		>
			<Icon className='size-[18px]' />
		</div>
	)
}
