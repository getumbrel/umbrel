import React from 'react'
import {PiFlaskFill} from 'react-icons/pi'
import {useParams} from 'react-router-dom'

import {CopyableField} from '@/components/ui/copyable-field'
import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Icon, IconTypes} from '@/components/ui/icon'
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {Loading} from '@/components/ui/loading'
import {useIsExternalDns} from '@/hooks/use-is-externaldns'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/shadcn-components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {Switch} from '@/shadcn-components/ui/switch'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export default function AdvancedSettingsDrawerOrDialog() {
	const title = t('advanced-settings')
	const dialogProps = useSettingsDialogProps()

	const isBetaChannel = useIsBetaChannel()

	const isExternalDns = useIsExternalDns()

	const isMobile = useIsMobile()

	const tor = useTorEnabled()
	const hiddenServiceQ = trpcReact.system.hiddenService.useQuery(undefined, {
		enabled: tor.enabled,
	})

	// Track the last action (enable/disable) to show appropriate cover message
	const [torEnabling, setTorEnabling] = React.useState(false)

	const handleTorToggle = (checked: boolean) => {
		setTorEnabling(checked)
		tor.setEnabled(checked)
	}

	const {advancedSelection} = useParams<{
		advancedSelection?: 'beta-program' | 'external-dns' | 'tor'
	}>()

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

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader>
						<DrawerTitle>{title}</DrawerTitle>
					</DrawerHeader>
					<DrawerScroller>
						<div className='flex flex-col gap-y-3'>
							<label className={cardClass}>
								<CardText title={t('terminal')} description={t('terminal-description')} />
								<IconButtonLink className='pointer-events-auto self-center' to={'/settings/terminal'}>
									{t('open')}
								</IconButtonLink>
							</label>
							<label className={cn(cardClass, advancedSelection === 'beta-program' && 'umbrel-pulse-a-few-times')}>
								<CardText
									title={t('beta-program')}
									description={t('beta-program-description')}
									trailingIcon={PiFlaskFill}
								/>
								<Switch
									className={cn('pointer-events-auto', isBetaChannel.isLoading && 'umbrel-pulse')}
									checked={isBetaChannel.isChecked}
									onCheckedChange={isBetaChannel.change}
									disabled={isBetaChannel.isLoading}
								/>
							</label>
							<label className={cn(cardClass, advancedSelection === 'external-dns' && 'umbrel-pulse-a-few-times')}>
								<CardText title={t('external-dns')} description={t('external-dns-description')} />
								<Switch
									className={cn('pointer-events-auto', isExternalDns.isLoading && 'umbrel-pulse')}
									checked={isExternalDns.isChecked}
									onCheckedChange={isExternalDns.change}
									disabled={isExternalDns.isLoading}
								/>
							</label>
							{remoteTorAccessSettingRow}
							<label className={cardClass}>
								<CardText title={t('factory-reset')} description={t('factory-reset-description')} />
								<IconButtonLink className='pointer-events-auto self-center' to={'/factory-reset'} variant='destructive'>
									{t('reset')}
								</IconButtonLink>
							</label>
						</div>
					</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<div className='space-y-6 px-5 py-6'>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
					</DialogHeader>
					<div className='flex flex-col gap-y-3'>
						<label className={cardClass}>
							<CardText title={t('terminal')} description={t('terminal-description')} />
							<IconButtonLink className='pointer-events-auto self-center' to={'/settings/terminal'}>
								{t('open')}
							</IconButtonLink>
						</label>
						<label className={cn(cardClass, advancedSelection === 'beta-program' && 'umbrel-pulse-a-few-times')}>
							<CardText
								title={t('beta-program')}
								description={t('beta-program-description')}
								trailingIcon={PiFlaskFill}
							/>
							<Switch
								className={cn('pointer-events-auto', isBetaChannel.isLoading && 'umbrel-pulse')}
								checked={isBetaChannel.isChecked}
								onCheckedChange={isBetaChannel.change}
								disabled={isBetaChannel.isLoading}
							/>
						</label>
						<label className={cn(cardClass, advancedSelection === 'external-dns' && 'umbrel-pulse-a-few-times')}>
							<CardText title={t('external-dns')} description={t('external-dns-description')} />
							<Switch
								className={cn('pointer-events-auto', isExternalDns.isLoading && 'umbrel-pulse')}
								checked={isExternalDns.isChecked}
								onCheckedChange={isExternalDns.change}
								disabled={isExternalDns.isLoading}
							/>
						</label>
						{remoteTorAccessSettingRow}
						<label className={cardClass}>
							<CardText title={t('factory-reset')} description={t('factory-reset-description')} />
							<IconButtonLink className='pointer-events-auto self-center' to={'/factory-reset'} variant='destructive'>
								{t('reset')}
							</IconButtonLink>
						</label>
					</div>
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
			<h3 className='text-14 font-medium leading-tight'>
				{title}
				{trailingIcon && <Icon component={trailingIcon} className='ml-2 inline-block opacity-50' />}
			</h3>
			<p className='text-13 leading-tight opacity-45'>{description}</p>
		</div>
	)
}

const cardClass = tw`flex items-start gap-x-2 rounded-12 bg-white/6 p-4 pointer-events-none`
