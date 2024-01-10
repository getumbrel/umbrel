import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

export function WallpaperDrawer() {
	const title = 'Wallpaper'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('wallpaper')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Choose your Umbrel wallpaper</DrawerDescription>
				</DrawerHeader>
			</DrawerContent>
		</Drawer>
	)
}
