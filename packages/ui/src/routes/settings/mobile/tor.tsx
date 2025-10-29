import {CopyableField} from '@/components/ui/copyable-field'
import {listClass, listItemClass} from '@/components/ui/list'
import {Spinner} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {Switch} from '@/shadcn-components/ui/switch'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function TorDrawer() {
	const title = t('remote-tor-access')
	const dialogProps = useSettingsDialogProps()

	const {enabled, setEnabled, isMutLoading, isError} = useTorEnabled({
		onSuccess: (enabled) => {
			if (enabled) {
				toast.success(t('tor.enable.success'))
			} else {
				toast.success(t('tor.disable.success'))
			}
			dialogProps.onOpenChange(false)
		},
	})

	if (isError) {
		dialogProps.onOpenChange(false)
	}

	const hiddenServiceQ = trpcReact.system.hiddenService.useQuery(undefined, {enabled})

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('tor-description')}</DrawerDescription>
				</DrawerHeader>
				<div className={listClass}>
					<label className={listItemClass}>
						{t('tor.enable.mobile.switch-label')}
						<div className='flex items-center gap-2'>
							{isMutLoading && <Spinner />}
							<Switch checked={enabled} onCheckedChange={setEnabled} disabled={isMutLoading} />
						</div>
					</label>
				</div>
				<div className='text-12 font-normal leading-tight -tracking-2 text-white/60'>{t('tor.enable.description')}</div>
				{enabled && (
					<div className='space-y-2'>
						<span className='text-15 font-medium -tracking-4'>{t('tor.hidden-service')}</span>
						<CopyableField value={hiddenServiceQ.data ?? ''} />
					</div>
				)}
			</DrawerContent>
		</Drawer>
	)
}
