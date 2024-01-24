import {ButtonLink} from '@/components/ui/button-link'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps, useLinkToDialog} from '@/utils/dialog'

export function StartMigrationDrawer() {
	const title = 'Migration Assistant'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('start-migration')
	const linkToDialog = useLinkToDialog()

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader className='flex flex-col items-center text-center'>
					<div className='py-5'>
						<img
							src='/migration-assistant/migrate-raspberrypi-umbrel-home.png'
							width={111}
							height={104}
							alt='Image displaying migration from Raspberry Pi to Umbrel Home'
						/>
					</div>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>
						Move data from Raspberry Pi to Umbrel Home seamlessly and migrate in few steps
					</DrawerDescription>
				</DrawerHeader>
				<DrawerFooter>
					<ButtonLink to={linkToDialog('migration-assistant')} variant='primary' size='dialog'>
						Start migration
					</ButtonLink>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}
