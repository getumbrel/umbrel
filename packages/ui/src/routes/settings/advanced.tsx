import {PiFlaskFill} from 'react-icons/pi'
import {useParams} from 'react-router-dom'

import {Icon, IconTypes} from '@/components/ui/icon'
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {useIsExternalDns} from '@/hooks/use-is-externaldns'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/shadcn-components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
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

	const {advancedSelection} = useParams<{advancedSelection?: 'beta-program' | 'external-dns'}>()

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent>
					<div className='space-y-6 px-5 py-6'>
						<DrawerHeader>
							<DrawerTitle>{title}</DrawerTitle>
						</DrawerHeader>
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
							<label className={cardClass}>
								<CardText title={t('factory-reset')} description={t('factory-reset-description')} />
								<IconButtonLink className='pointer-events-auto self-center' to={'/factory-reset'} variant='destructive'>
									{t('reset')}
								</IconButtonLink>
							</label>
						</div>
					</div>
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
							<IconButtonLink className='self-center, pointer-events-auto' to={'/settings/terminal'}>
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

	const isLoading = releaseChannelMut.isLoading || releaseChannelQ.isLoading

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
