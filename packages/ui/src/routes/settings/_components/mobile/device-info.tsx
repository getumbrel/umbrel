import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

export function DeviceInfoDrawer() {
	const title = 'Device info'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('device-info')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Device type and current software version</DrawerDescription>
				</DrawerHeader>
			</DrawerContent>
		</Drawer>
	)
}
