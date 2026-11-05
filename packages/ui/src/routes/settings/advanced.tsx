import React from 'react'
import {useTranslation} from 'react-i18next'
import {PiFlaskFill} from 'react-icons/pi'
import {TbChevronRight} from 'react-icons/tb'
import {useParams, useSearchParams} from 'react-router-dom'

import {AnimatedHeight} from '@/components/ui/animated-height'
import {CopyableField} from '@/components/ui/copyable-field'
import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/components/ui/drawer'
import {Icon, IconTypes} from '@/components/ui/icon'
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {Loading} from '@/components/ui/loading'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {useIsPhone} from '@/hooks/use-is-mobile'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {cn} from '@/lib/utils'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {NetworkPanel} from '@/routes/settings/advanced-network'
import {HttpsCertificateSettingsPanel} from '@/routes/settings/https-access'
import {ThunderboltSettingsPanel} from '@/routes/settings/thunderbolt'
import {trpcReact} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

type AdvancedPanel = 'overview' | 'network' | 'https-certificate' | 'thunderbolt'

function panelFromSelection(selection: string | undefined, isThunderboltSupported: boolean): AdvancedPanel {
	if (selection === 'network') return 'network'
	if (selection === 'thunderbolt' && isThunderboltSupported) return 'thunderbolt'
	return 'overview'
}

export default function AdvancedSettingsDrawerOrDialog() {
	const {t} = useTranslation()
	const title = t('advanced-settings')
	const dialogProps = useSettingsDialogProps()
	const {advancedSelection} = useParams<{
		advancedSelection?: 'beta-program' | 'network' | 'thunderbolt' | 'tor'
	}>()
	const [searchParams] = useSearchParams()

	const isBetaChannel = useIsBetaChannel()

	const isPhone = useIsPhone()

	// Umbrel Home and Umbrel Pro have no Thunderbolt ports, so the panel is inert there.
	const {isHomeOrPro} = useIsHomeOrPro()
	const isThunderboltSupported = !isHomeOrPro

	const tor = useTorEnabled()
	const hiddenServiceQ = trpcReact.system.hiddenService.useQuery(undefined, {
		enabled: tor.enabled,
	})

	// Track the last action (enable/disable) to show appropriate cover message
	const [torEnabling, setTorEnabling] = React.useState(false)
	const [activePanel, setActivePanel] = React.useState<AdvancedPanel>(() =>
		panelFromSelection(advancedSelection, isThunderboltSupported),
	)

	const handleTorToggle = (checked: boolean) => {
		setTorEnabling(checked)
		tor.setEnabled(checked)
	}

	// Keep URL-driven shortcuts in sync without coupling manual panel navigation
	// to the route parameter.
	React.useEffect(() => {
		setActivePanel(panelFromSelection(advancedSelection, isThunderboltSupported))
	}, [advancedSelection, isThunderboltSupported])

	const remoteTorAccessSettingRow = (
		<div className={cn('flex flex-col gap-2', cardClass, advancedSelection === 'tor' && 'umbrel-pulse-a-few-times')}>
			<label className='flex w-full items-center justify-between gap-x-2'>
				<CardText
					title={t('remote-tor-access')}
					description={tor.enabled ? t('tor-enabled-description') : t('tor-description')}
				/>
				<Switch
					className={cn('pointer-events-auto', tor.isMutLoading && 'umbrel-pulse')}
					checked={!!tor.enabled}
					onCheckedChange={handleTorToggle}
					disabled={tor.isLoading}
				/>
			</label>
			{tor.enabled && hiddenServiceQ.data && (
				<CopyableField narrow className='pointer-events-auto w-full' value={hiddenServiceQ.data} />
			)}
		</div>
	)

	const networkSettingRow = (
		<button
			onClick={() => setActivePanel('network')}
			className={cn(cardClass, 'pointer-events-auto cursor-pointer text-left transition-colors hover:bg-white/8')}
		>
			<CardText title={t('network')} description={t('network-description')} />
			<TbChevronRight className='pointer-events-auto mt-0.5 size-4.5 shrink-0 self-center text-white/30' />
		</button>
	)

	const thunderboltSettingRow = isThunderboltSupported ? (
		<button
			onClick={() => setActivePanel('thunderbolt')}
			className={cn(cardClass, 'pointer-events-auto cursor-pointer text-left transition-colors hover:bg-white/8')}
		>
			<CardText title={t('thunderbolt-settings.title')} description={t('thunderbolt-settings.description')} />
			<TbChevronRight className='pointer-events-auto mt-0.5 size-4.5 shrink-0 self-center text-white/30' />
		</button>
	) : (
		<div className={cn(cardClass, 'opacity-50')}>
			<CardText
				title={t('thunderbolt-settings.title')}
				description={t('thunderbolt-settings.unsupported-description')}
			/>
		</div>
	)

	// Show loading cover state while enabling/disabling Tor
	if (tor.isMutLoading) {
		return (
			<CoverMessage>
				<Loading>{torEnabling ? t('enabling-tor') : t('tor.disable.progress')}</Loading>
				<CoverMessageParagraph>
					{torEnabling ? t('tor.enable.description') : t('tor.disable.description')}
				</CoverMessageParagraph>
			</CoverMessage>
		)
	}

	const mainContent = (
		<div className='flex flex-col gap-y-3'>
			<label className={cardClass}>
				<CardText title={t('terminal')} description={t('terminal-description')} />
				<IconButtonLink className='pointer-events-auto self-center' to='/settings?dialog=terminal'>
					{t('open')}
				</IconButtonLink>
			</label>
			<label className={cn(cardClass, advancedSelection === 'beta-program' && 'umbrel-pulse-a-few-times')}>
				<CardText title={t('beta-program')} description={t('beta-program-description')} trailingIcon={PiFlaskFill} />
				<Switch
					className={cn('pointer-events-auto', isBetaChannel.isLoading && 'umbrel-pulse')}
					checked={isBetaChannel.isChecked}
					onCheckedChange={isBetaChannel.change}
					disabled={isBetaChannel.isLoading}
				/>
			</label>
			{networkSettingRow}
			{thunderboltSettingRow}
			{remoteTorAccessSettingRow}
			<label className={cardClass}>
				<CardText title={t('factory-reset')} description={t('factory-reset-description')} />
				<IconButtonLink className='pointer-events-auto self-center' to={'/factory-reset'} variant='destructive'>
					{t('reset')}
				</IconButtonLink>
			</label>
		</div>
	)

	const content =
		activePanel === 'thunderbolt' && isThunderboltSupported ? (
			<ThunderboltSettingsPanel onBack={() => setActivePanel('overview')} />
		) : activePanel === 'https-certificate' ? (
			<HttpsCertificateSettingsPanel onBack={() => setActivePanel('network')} />
		) : activePanel === 'network' ? (
			<NetworkPanel
				onBack={() => setActivePanel('overview')}
				onOpenHttpsCertificateSettings={() => setActivePanel('https-certificate')}
				expandHttpsAccessInstructions={searchParams.get('httpsAccess') === 'guide'}
			/>
		) : (
			mainContent
		)
	const showOverview = activePanel === 'overview'

	if (isPhone) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader className={cn(!showOverview && 'sr-only')}>
						<DrawerTitle>{title}</DrawerTitle>
					</DrawerHeader>
					<DrawerScroller>{content}</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<AnimatedHeight>
					<div className='space-y-6 px-5 py-6'>
						<DialogHeader className={cn(!showOverview && 'sr-only')}>
							<DialogTitle>{title}</DialogTitle>
						</DialogHeader>
						{content}
					</div>
				</AnimatedHeight>
			</DialogScrollableContent>
		</Dialog>
	)
}

function useIsBetaChannel() {
	const {t} = useTranslation()
	const releaseChannelQ = trpcReact.update.getReleaseChannel.useQuery()
	const isChecked = releaseChannelQ.data === 'beta'
	const {checkLatest} = useSoftwareUpdate()

	const releaseChannelMut = trpcReact.update.setReleaseChannel.useMutation({
		onSuccess: () => {
			releaseChannelQ.refetch()
			checkLatest()
		},
		// Otherwise the switch just flips back, with nothing to say it didn't take
		onError: (error) => toast.error(t('beta-program-error', {message: error.message}), {area: 'settings'}),
	})

	const change = (checked: boolean) => {
		if (checked) {
			releaseChannelMut.mutate({channel: 'beta'})
		} else {
			releaseChannelMut.mutate({channel: 'stable'})
		}
	}

	const isLoading = releaseChannelMut.isPending || releaseChannelQ.isLoading

	return {isChecked, change, isLoading}
}

function CardText({title, description, trailingIcon}: {title: string; description: string; trailingIcon?: IconTypes}) {
	return (
		<div className='flex-1 space-y-1'>
			<h3 className='text-14 leading-tight font-medium'>
				{title}
				{trailingIcon && <Icon component={trailingIcon} className='ml-2 inline-block opacity-50' />}
			</h3>
			<p className='text-13 leading-tight opacity-45'>{description}</p>
		</div>
	)
}

const cardClass = tw`flex items-start gap-x-2 rounded-12 bg-white/6 p-4 pointer-events-none`
