import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

export function AppStorePreferencesDrawer() {
	const title = 'App Store Preferences'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('app-store-preferences')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>App store settings & app updates</DrawerDescription>
				</DrawerHeader>
			</DrawerContent>
		</Drawer>
	)
}
