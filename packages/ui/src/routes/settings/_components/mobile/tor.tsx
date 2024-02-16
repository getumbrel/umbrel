import {listClass, listItemClass} from '@/components/ui/list'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {Switch} from '@/shadcn-components/ui/switch'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export function TorDrawer() {
	const title = t('tor-long')
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('tor')

	const {enabled, setEnabled, isError} = useTorEnabled()

	if (isError) {
		throw new Error(t('tor.enable.failed'))
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('tor-description-long')}</DrawerDescription>
				</DrawerHeader>
				<div className={listClass}>
					<label className={listItemClass}>
						{t('tor.enable.mobile.switch-label')}
						<Switch checked={enabled} onCheckedChange={setEnabled} />
					</label>
				</div>
			</DrawerContent>
		</Drawer>
	)
}
