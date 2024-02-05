import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

import {AppStorePreferencesContent} from '../app-store-preferences-content'

export function AppStorePreferencesDrawer() {
	const title = 'App Store Preferences'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('app-store-preferences')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight withScroll>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>App store settings & app updates</DrawerDescription>
				</DrawerHeader>
				<DrawerScroller>
					<div className='flex flex-col gap-5'>
						<AppStorePreferencesContent />
					</div>
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}
