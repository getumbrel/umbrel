import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

export function TorDrawer() {
	const title = 'Remote Tor access'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('tor')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Access Umbrel from anywhere using Tor</DrawerDescription>
				</DrawerHeader>
			</DrawerContent>
		</Drawer>
	)
}
