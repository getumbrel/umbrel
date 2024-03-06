import {listClass, listItemClass} from '@/components/ui/list'
import {Loading} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {Switch} from '@/shadcn-components/ui/switch'
import {t} from '@/utils/i18n'

export function TorDrawer() {
	const title = t('tor-long')
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
		throw new Error(t('tor.enable.failed'))
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('tor-description-long')}</DrawerDescription>
				</DrawerHeader>
				<div className={listClass}>
					<label className={listItemClass}>
						{t('tor.enable.mobile.switch-label')}
						<Switch checked={enabled} onCheckedChange={setEnabled} disabled={isMutLoading} />
					</label>
				</div>
				<div>{t('tor.enable.description')}</div>
				{isMutLoading && <Loading>{enabled ? 'Disabling Tor' : 'Enabling Tor'}</Loading>}
			</DrawerContent>
		</Drawer>
	)
}
