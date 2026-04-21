import React from 'react'
import {useTranslation} from 'react-i18next'
import {PiFlaskFill} from 'react-icons/pi'
import {TbChevronRight} from 'react-icons/tb'
import {useParams} from 'react-router-dom'

import {CopyableField} from '@/components/ui/copyable-field'
import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/components/ui/drawer'
import {Icon, IconTypes} from '@/components/ui/icon'
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {Loading} from '@/components/ui/loading'
import {Switch} from '@/components/ui/switch'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {cn} from '@/lib/utils'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {NetworkPanel} from '@/routes/settings/advanced-network'
import {trpcReact} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

export default function AdvancedSettingsDrawerOrDialog() {
	const {t} = useTranslation()
	const title = t('advanced-settings')
	const dialogProps = useSettingsDialogProps()

	const isBetaChannel = useIsBetaChannel()

	const isMobile = useIsMobile()

	const tor = useTorEnabled()
	const hiddenServiceQ = trpcReact.system.hiddenService.useQuery(undefined, {
		enabled: tor.enabled,
	})

	// Track the last action (enable/disable) to show appropriate cover message
	const [torEnabling, setTorEnabling] = React.useState(false)
	const [showNetwork, setShowNetwork] = React.useState(false)

	const handleTorToggle = (checked: boolean) => {
		setTorEnabling(checked)
		tor.setEnabled(checked)
	}

	const {advancedSelection} = useParams<{
		advancedSelection?: 'beta-program' | 'network' | 'tor'
	}>()

	// Auto-open network panel if URL has advancedSelection=network
	React.useEffect(() => {
		if (advancedSelection === 'network') setShowNetwork(true)
	}, [advancedSelection])

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
			onClick={() => setShowNetwork(true)}
			className={cn(cardClass, 'pointer-events-auto cursor-pointer text-left transition-colors hover:bg-white/8')}
		>
			<CardText title={t('network')} description={t('network-description')} />
			<TbChevronRight className='pointer-events-auto mt-0.5 size-4.5 shrink-0 self-center text-white/30' />
		</button>
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
				<IconButtonLink className='pointer-events-auto self-center' to={'/settings/terminal'}>
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
			{remoteTorAccessSettingRow}
			<label className={cardClass}>
				<CardText title={t('factory-reset')} description={t('factory-reset-description')} />
				<IconButtonLink className='pointer-events-auto self-center' to={'/factory-reset'} variant='destructive'>
					{t('reset')}
				</IconButtonLink>
			</label>
		</div>
	)

	const animatedContent = showNetwork ? <NetworkPanel onBack={() => setShowNetwork(false)} /> : mainContent

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					{!showNetwork && (
						<DrawerHeader>
							<DrawerTitle>{title}</DrawerTitle>
						</DrawerHeader>
					)}
					<DrawerScroller>{animatedContent}</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<div className='space-y-6 px-5 py-6'>
					{!showNetwork && (
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
						</DialogHeader>
					)}
					{animatedContent}
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}

function useIsBetaChannel() {
	const releaseChannelQ = trpcReact.system.getReleaseChannel.useQuery()
	const isChecked = releaseChannelQ.data === 'beta'
	const {checkLatest} = useSoftwareUpdate()

	const releaseChannelMut = trpcReact.system.setReleaseChannel.useMutation({
		onSuccess: () => {
			releaseChannelQ.refetch()
			checkLatest()
		},
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
