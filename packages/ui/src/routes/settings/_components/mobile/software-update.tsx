import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

export function SoftwareUpdateDrawer() {
	const title = 'Software update'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('software-update')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Check for latest software version and upgrade to it</DrawerDescription>
				</DrawerHeader>
				<div>Hello</div>
			</DrawerContent>
		</Drawer>
	)
}
