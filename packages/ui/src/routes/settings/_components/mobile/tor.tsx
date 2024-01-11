import {listClass, listItemClass} from '@/components/ui/list'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {Switch} from '@/shadcn-components/ui/switch'
import {useDialogOpenProps} from '@/utils/dialog'

export function TorDrawer() {
	const title = 'Remote Tor access'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('tor')

	const {enabled, setEnabled, isError} = useTorEnabled()

	if (isError) {
		throw new Error('Failed to enable.')
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Access Umbrel from anywhere using Tor</DrawerDescription>
				</DrawerHeader>
				<div className={listClass}>
					<label className={listItemClass}>
						Enable remote Tor access
						<Switch checked={enabled} onCheckedChange={setEnabled} />
					</label>
				</div>
			</DrawerContent>
		</Drawer>
	)
}
