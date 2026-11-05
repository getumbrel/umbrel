import {ChevronRight, Loader2} from 'lucide-react'
import {motion, useReducedMotion} from 'motion/react'
import {Fragment, ReactNode, useEffect, useMemo, useRef, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {Link, useNavigate, useParams} from 'react-router-dom'

import {ChevronDown} from '@/components/chevron-down'
import {BetaPill} from '@/components/ui/beta-pill'
import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {Card} from '@/components/ui/card'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {SearchField} from '@/components/ui/edge-controls'
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {ScrollArea} from '@/components/ui/scroll-area'
import {Separator} from '@/components/ui/separator'
import {Switch} from '@/components/ui/switch'
import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {useBackups} from '@/features/backups/hooks/use-backups'
import {getDeviceHealth} from '@/features/storage/hooks/use-storage'
import {useCpuTemperature} from '@/hooks/use-cpu-temperature'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {DesktopPreviewConnected, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {WifiListRowConnectedDescription} from '@/modules/wifi/wifi-list-row-connected-description'
import {useWallpaper, WallpaperAvifSource} from '@/providers/wallpaper'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {SettingsSummary} from '@/routes/settings/_components/settings-summary'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {firstNameFromFullName} from '@/utils/misc'

import {CpuCardContent} from './cpu-card-content'
import {CpuTemperatureCardContent} from './cpu-temperature-card-content'
import {ListRow} from './list-row'
import {MemoryCardContent} from './memory-card-content'
import {createSettingsCatalog, getSettingsPage, SettingsPageItem} from './settings-catalog'
import {SettingsFilterPills, SettingsItemsGroup} from './settings-page-controls'
import {SettingsFilterId, useSettingsFilterLabels} from './settings-taxonomy'
import {SettingsAccountAvatar, settingsPanesGridClass, settingsSidePaneClass} from './shared'
import {SoftwareUpdateListRow} from './software-update-list-row'
import {StorageCardContent} from './storage-card-content'
import {WallpaperPicker} from './wallpaper-picker'

function RowChevron() {
	return <ChevronRight className='size-4 text-white/55' aria-hidden='true' />
}

function LiveUsageCardLink({
	tab,
	id,
	className,
	children,
}: {
	tab: 'storage' | 'memory' | 'cpu'
	id?: string
	className?: string
	children: ReactNode
}) {
	const {addLinkSearchParams} = useQueryParams()
	const reduceMotion = Boolean(useReducedMotion())

	return (
		<Link
			to={{search: addLinkSearchParams({dialog: 'live-usage', 'live-usage-tab': tab})}}
			id={id}
			className={cn(
				'block shrink-0 rounded-24 outline-hidden focus-visible:ring-2 focus-visible:ring-white/20',
				className,
			)}
		>
			<motion.div
				className='will-change-transform'
				whileHover={reduceMotion ? undefined : {scale: 1.02, filter: 'brightness(1.15)'}}
				whileTap={reduceMotion ? undefined : {scale: 0.97}}
				transition={{type: 'spring', duration: 0.2, bounce: 0.15}}
			>
				<Card className='settings-edge-material rounded-24 !p-5'>{children}</Card>
			</motion.div>
		</Link>
	)
}

export function SettingsContent({isMember = false}: {isMember?: boolean}) {
	const {t} = useTranslation()
	const filterLabels = useSettingsFilterLabels()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const [languageOpen, setLanguageOpen] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [settingsFilter, setSettingsFilter] = useState<SettingsFilterId>('all')
	const sidebarScrollRef = useRef<HTMLDivElement>(null)
	const rowsScrollRef = useRef<HTMLDivElement>(null)

	const cpuTemp = useCpuTemperature({enabled: !isMember})
	const {deviceName} = useIsHomeOrPro()
	const {wallpaper} = useWallpaper()

	const [userQ, wifiSupportedQ, is2faEnabledQ, raidStatusQ, devicesQ] = trpcReact.useQueries((t) => [
		t.user.get(),
		t.wifi.supported(undefined, {enabled: !isMember}),
		t.user.is2faEnabled(undefined, {enabled: isMember}),
		t.hardware.raid.getStatus(undefined, {enabled: !isMember}),
		t.hardware.internalStorage.getDevices(undefined, {enabled: !isMember}),
	])
	const wifiQ = trpcReact.wifi.connected.useQuery(undefined, {enabled: !isMember && wifiSupportedQ.data === true})
	const {repositories: backupRepositories, isLoadingRepositories: isLoadingBackups} = useBackups({
		repositoriesEnabled: !isMember,
	})
	const hasRaidIssue = raidStatusQ.data?.exists && raidStatusQ.data?.status && raidStatusQ.data?.status !== 'ONLINE'
	const hasHealthIssue = devicesQ.data?.some((device) => getDeviceHealth(device).hasWarning)
	const hasStorageIssue = hasRaidIssue || hasHealthIssue
	// SSD wording only when the machine is known to be SSD-only - HDD, mixed, and not-yet-loaded
	// setups get generic drive wording (correct for any device type)
	const storageIssueLabel = devicesQ.data?.every((device) => device.type === 'ssd')
		? t('storage-manager.health.title')
		: t('storage-manager.health.title-drive')
	const {settingsDialog} = useParams<{settingsDialog: 'wallpaper' | 'language' | 'software-update'}>()
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
		() => getSettingsPage(settingsCatalog, {query: searchQuery, filter: settingsFilter}),
		[settingsCatalog, searchQuery, settingsFilter],
	)

	useEffect(() => {
		if (!location.hash) return

		const target = document.querySelector<HTMLElement>(location.hash)
		const scroller = sidebarScrollRef.current?.contains(target) ? sidebarScrollRef.current : rowsScrollRef.current
		if (!scroller || !target) return

		const scrollerRect = scroller.getBoundingClientRect()
		const targetRect = target.getBoundingClientRect()
		const centeredTop =
			scroller.scrollTop + targetRect.top - scrollerRect.top - (scroller.clientHeight - targetRect.height) / 2
		scroller.scrollTop = Math.max(0, centeredTop)
	}, [])

	const resetRowsScroll = () => rowsScrollRef.current?.scrollTo(0, 0)

	const handleFilterSelect = (filter: SettingsFilterId) => {
		setSettingsFilter(filter)
		resetRowsScroll()
	}

	const handleSearchChange = (query: string) => {
		setSearchQuery(query)
		resetRowsScroll()
	}

	// The preview renders the whole app grid, including layout-animated icons. It is
	// independent of search, so keep it out of the search keystroke render path.
	const desktopPreview = useMemo(
		() => (
			<DesktopPreviewFrame>
				<DesktopPreviewConnected />
			</DesktopPreviewFrame>
		),
		[],
	)

	const renderSettingsItem = (item: SettingsPageItem) => {
		switch (item.id) {
			case '2fa':
				return (
					<ListRow
						icon={item.icon}
						title={item.title}
						description={item.description}
						disabled={is2faEnabledQ.isLoading}
					>
						<Switch checked={is2faEnabledQ.data ?? false} onCheckedChange={() => navigate(item.to)} />
					</ListRow>
				)
			case 'wallpaper':
				return (
					<ListRow
						icon={item.icon}
						title={item.title}
						description={item.description}
						isActive={settingsDialog === 'wallpaper'}
					>
						<div className='-mx-2 max-w-[170px]'>
							<WallpaperPicker maxW={170} />
						</div>
					</ListRow>
				)
			case 'language':
				return (
					<ListRow
						icon={item.icon}
						title={item.title}
						description={item.description}
						isActive={settingsDialog === 'language'}
					>
						<div className="[&>button]:after:absolute [&>button]:after:inset-0 [&>button]:after:cursor-pointer [&>button]:after:content-['']">
							<LanguageDropdown open={languageOpen} onOpenChange={setLanguageOpen} />
						</div>
					</ListRow>
				)
			case 'wifi': {
				const supported = wifiSupportedQ.data
				return (
					<ListRow
						icon={item.icon}
						title={item.title}
						description={
							wifiQ.data?.status === 'connected' ? (
								<WifiListRowConnectedDescription network={wifiQ.data} />
							) : (
								item.description
							)
						}
						disabled={wifiSupportedQ.isLoading || (supported === true && wifiQ.isLoading)}
						onClick={() => navigate(supported === false ? '/settings/wifi-unsupported' : item.to)}
					>
						<RowChevron />
					</ListRow>
				)
			}
			case 'storage':
				return (
					<ListRow
						icon={item.icon}
						title={
							<span className='flex items-center gap-1.5'>
								{item.title}
								{hasStorageIssue && (
									<span className='relative size-2.5' role='img' aria-label={storageIssueLabel}>
										<span className='absolute inset-0 rounded-full bg-[#FF3434]' />
										<span className='absolute inset-0 animate-ping rounded-full bg-[#FF3434] opacity-75' />
									</span>
								)}
							</span>
						}
						description={item.description}
						onClick={() => navigate(item.to)}
					>
						<RowChevron />
					</ListRow>
				)
			case 'backups':
				return (
					<ListRow icon={item.icon} title={item.title} description={item.description}>
						<div className='flex flex-wrap justify-end gap-2'>
							{isLoadingBackups ? (
								<div className='flex h-[30px] items-center'>
									<Loader2 className='size-4 animate-spin text-white/60' aria-label={t('loading')} />
								</div>
							) : (backupRepositories?.length ?? 0) === 0 ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button>
											{t('backups-setup')}
											<ChevronDown />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align='end' className='min-w-[280px]'>
										<DropdownMenuItem onSelect={() => navigate('/settings/backups/setup?backups-setup-tab=nas')}>
											<div className='flex flex-col'>
												<div className='text-14 font-medium'>{t('backups-setup-umbrel-or-nas')}</div>
												<div className='text-12 text-white/40'>{t('backups-setup-nas-or-umbrel-description')}</div>
											</div>
										</DropdownMenuItem>
										<DropdownMenuItem onSelect={() => navigate('/settings/backups/setup?backups-setup-tab=external')}>
											<div className='flex flex-col'>
												<div className='text-14 font-medium'>{t('external-drive')}</div>
												<div className='text-12 text-white/40'>{t('backups-setup-external-description')}</div>
											</div>
										</DropdownMenuItem>
										<DropdownMenuItem
											onSelect={() => navigate('/settings/backups/setup?backups-setup-tab=umbrel-private-cloud')}
										>
											<div className='flex flex-col'>
												<div className='text-14 font-medium'>{t('backups-setup-umbrel-private-cloud')}</div>
												<div className='text-12 text-white/40'>
													{t('backups-setup-umbrel-private-cloud-description')}
												</div>
											</div>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							) : (
								<IconButtonLink to='/settings/backups/configure'>{t('backups-configure')}</IconButtonLink>
							)}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button>
										{t('backups-restore')}
										<ChevronDown />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align='end' className='min-w-[280px]'>
									<DropdownMenuItem onSelect={() => navigate('/settings/backups/restore')}>
										<div className='flex flex-col'>
											<div className='text-14 font-medium'>{t('backups-restore-full')}</div>
											<div className='text-12 text-white/40'>{t('backups-restore-full-description')}</div>
										</div>
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={() => navigate('/files/Home?rewind=open')}>
										<div className='flex flex-col'>
											<div className='text-14 font-medium'>{t('backups-rewind')}</div>
											<div className='text-12 text-white/40'>{t('backups-rewind-description')}</div>
										</div>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</ListRow>
				)
			case 'software-update':
				return (
					<SoftwareUpdateListRow
						isActive={settingsDialog === 'software-update'}
						icon={typeof item.icon === 'string' ? undefined : item.icon}
					/>
				)
			case 'support':
				return (
					<ListRow
						icon={item.icon}
						title={item.title}
						description={item.description}
						onClick={() => window.open(item.to, '_blank', 'noopener,noreferrer')}
					>
						<RowChevron />
					</ListRow>
				)
			case 'mcp':
				return (
					<ListRow
						icon={item.icon}
						title={
							<span className='flex items-center gap-1.5'>
								{item.title}
								<BetaPill />
							</span>
						}
						description={item.description}
						onClick={() => navigate(item.to)}
					>
						<RowChevron />
					</ListRow>
				)
			default:
				return (
					<ListRow icon={item.icon} title={item.title} description={item.description} onClick={() => navigate(item.to)}>
						<RowChevron />
					</ListRow>
				)
		}
	}

	return (
		<div className='relative h-full min-h-0 animate-in fade-in lg:flex-1'>
			<div
				className={cn(
					'grid h-full min-h-0 w-full items-start gap-[34px] lg:grid-cols-[286px_minmax(0,1fr)]',
					settingsPanesGridClass,
				)}
			>
				<aside className={cn('min-h-0 min-w-0 lg:-ml-4 lg:h-full lg:w-[calc(100%+50px)]', settingsSidePaneClass)}>
					<PaneScroller
						ref={sidebarScrollRef}
						data-testid='settings-sidebar-scroller'
						className='h-full'
						// The pane reaches across the gap to the rows, so the cards' shadows aren't
						// clipped. Its bar sits just past the column instead, as the rows' bar does.
						scrollbarClass='mr-[22px]'
						contentClassName='lg:pr-[34px] lg:pb-24 lg:pl-4 panes:-mx-3 panes:px-3'
					>
						<div className='flex flex-col gap-3'>
							<div className='flex shrink-0 flex-col items-center gap-5'>
								<div className='relative isolate lg:translate-x-2'>
									{wallpaper.id && (
										<picture>
											<WallpaperAvifSource wallpaper={wallpaper} tier='small' />
											<img
												src={wallpaper.url}
												alt=''
												aria-hidden='true'
												className='pointer-events-none absolute top-5 left-3 -z-10 h-[154px] w-[263px] translate-y-5 scale-[0.96] rounded-10 object-cover opacity-65 blur-[22px] saturate-150'
											/>
										</picture>
									)}
									<div className='relative z-10'>{desktopPreview}</div>
									{userQ.data && (
										<SettingsAccountAvatar
											name={userQ.data.name}
											userId={userQ.data.userId}
											avatarUrl={userQ.data.avatarUrl}
											controlsVisibility='hover'
										/>
									)}
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

							<div className='mt-1.5 mb-3 flex shrink-0 gap-2'>
								<ButtonLink to={linkToDialog('logout')} className='flex-1 px-1.5 text-11 whitespace-nowrap'>
									{t('logout')}
								</ButtonLink>
								{isMember ? (
									<>
										<Button disabled className='flex-1 px-1.5 text-11 whitespace-nowrap'>
											{t('restart')}
										</Button>
										<Button disabled text='destructive' className='flex-1 px-1.5 text-11 whitespace-nowrap'>
											{t('shut-down')}
										</Button>
									</>
								) : (
									<>
										<ButtonLink to={linkToDialog('restart')} className='flex-1 px-1.5 text-11 whitespace-nowrap'>
											{t('restart')}
										</ButtonLink>
										<ButtonLink
											to={linkToDialog('shutdown')}
											text='destructive'
											className='flex-1 px-1.5 text-11 whitespace-nowrap'
										>
											{t('shut-down')}
										</ButtonLink>
									</>
								)}
							</div>

							{!isMember && (
								<>
									<Separator />
									<LiveUsageCardLink tab='storage' className='mt-3'>
										<StorageCardContent />
									</LiveUsageCardLink>
									<LiveUsageCardLink tab='memory' id={SETTINGS_SYSTEM_CARDS_ID}>
										<MemoryCardContent />
									</LiveUsageCardLink>
									<LiveUsageCardLink tab='cpu'>
										<CpuCardContent />
									</LiveUsageCardLink>
									<Card className='group/temperature-card settings-edge-material shrink-0 rounded-24 !p-5'>
										<CpuTemperatureCardContent warning={cpuTemp.warning} temperatureInCelcius={cpuTemp.temperature} />
									</Card>

									<ButtonLink
										to={linkToDialog('live-usage')}
										className='mt-1 min-w-0 shrink-0 self-center px-6 text-11 whitespace-nowrap'
									>
										{t('open-live-usage')}
									</ButtonLink>
								</>
							)}
						</div>
					</PaneScroller>
				</aside>

				<main className='min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col'>
					<div
						data-testid='settings-controls-rail'
						className={cn(
							'z-20 -mx-2 mb-1 flex shrink-0 items-center justify-between gap-3 px-2 py-2 panes:flex-wrap panes:pt-0',
							isMember && 'justify-end',
						)}
					>
						{!isMember && (
							<SettingsFilterPills
								activeFilter={settingsFilter}
								labels={filterLabels}
								ariaLabel={t('settings.filters-label')}
								onSelect={handleFilterSelect}
								className='lg:shrink-0 low:hidden'
							/>
						)}
						{/* The pills are the row's fixed part from lg, the search takes what's left */}
						<SearchField
							value={searchQuery}
							onChange={handleSearchChange}
							label={t('search')}
							className='lg:min-w-0 lg:shrink panes:w-full'
						/>
					</div>

					<PaneScroller
						ref={rowsScrollRef}
						data-testid='settings-rows-scroller'
						// Reaches into the sheet's padding so the bar runs beside the cards, not over them
						className='-mr-3 min-h-0 flex-1'
						contentClassName='min-w-0 pt-2.5 lg:pr-3 lg:pb-24'
					>
						<div className='flex flex-col gap-5 pb-8'>
							{settingsPage.categoryIds.map((categoryId) => (
								<SettingsItemsGroup key={categoryId} id={categoryId} label={filterLabels[categoryId]} overflowVisible>
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
					</PaneScroller>
				</main>
			</div>
		</div>
	)
}

// On the desktop each pane scrolls on its own, with the slim scroll bar Files' sidebar
// and dialogs use, shown while the pane is hovered. Narrower, the panes are part of the
// sheet's scroll, so they're plain columns there.
function PaneScroller({
	ref,
	className,
	contentClassName,
	scrollbarClass,
	children,
	'data-testid': testId,
}: {
	ref: React.RefObject<HTMLDivElement | null>
	/** The pane's box on the desktop */
	className: string
	contentClassName: string
	scrollbarClass?: string
	children: ReactNode
	'data-testid'?: string
}) {
	const isMobile = useIsMobile()

	if (isMobile) {
		return (
			<div ref={ref} data-testid={testId} className={contentClassName}>
				{children}
			</div>
		)
	}

	return (
		<ScrollArea
			viewportRef={ref}
			data-testid={testId}
			className={cn(className, '[&>[data-radix-scroll-area-viewport]]:overscroll-contain')}
			scrollbarClass={scrollbarClass}
		>
			<div className={contentClassName}>{children}</div>
		</ScrollArea>
	)
}
