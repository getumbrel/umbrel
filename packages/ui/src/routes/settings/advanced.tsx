import {TbTerminal2} from 'react-icons/tb'

import {IconButtonLink} from '@/components/ui/icon-button-link'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/shadcn-components/ui/dialog'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {Switch} from '@/shadcn-components/ui/switch'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export default function AdvancedSettingsDrawerOrDialog() {
	const title = t('advanced-settings')
	const dialogProps = useSettingsDialogProps()

	const isBetaChannel = useIsBetaChannel()

	const isMobile = useIsMobile()

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
								<IconButtonLink className='self-center' to={'/settings/terminal'} icon={TbTerminal2}>
									{t('open')}
								</IconButtonLink>
							</label>
							<label className={cardClass}>
								<CardText title={t('beta-program')} description={t('beta-program-description')} />
								<Switch
									checked={isBetaChannel.isChecked}
									onCheckedChange={isBetaChannel.change}
									disabled={isBetaChannel.isLoading}
								/>
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
							<IconButtonLink className='self-center' to={'/settings/terminal'} icon={TbTerminal2}>
								{t('open')}
							</IconButtonLink>
						</label>
						<label className={cardClass}>
							<CardText title={t('beta-program')} description={t('beta-program-description')} />
							<Switch
								checked={isBetaChannel.isChecked}
								onCheckedChange={isBetaChannel.change}
								disabled={isBetaChannel.isLoading}
							/>
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

	const releaseChannelMut = trpcReact.system.setReleaseChannel.useMutation({
		onSuccess: () => {
			releaseChannelQ.refetch()
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

function CardText({title, description}: {title: string; description: string}) {
	return (
		<div className='flex-1 space-y-1'>
			<h3 className='text-14 font-medium leading-tight'>{title}</h3>
			<p className='text-13 leading-tight opacity-45'>{description}</p>
		</div>
	)
}

const cardClass = tw`flex items-start gap-x-2 rounded-12 bg-white/6 p-4`
