import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

export function AccountDrawer() {
	const title = 'Account'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('account')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Your display name & Umbrel password</DrawerDescription>
				</DrawerHeader>
			</DrawerContent>
		</Drawer>
	)
}
