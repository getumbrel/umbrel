import {ButtonLink} from '@/components/ui/button-link'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {MigrateImage} from '@/modules/migrate/migrate-image'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps, useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export function StartMigrationDrawer() {
	const title = t('migration-assistant')
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('start-migration')
	const linkToDialog = useLinkToDialog()

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader className='flex flex-col items-center text-center'>
					<div className='py-5'>
						<MigrateImage />
					</div>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('migration-assistant-description-long')}</DrawerDescription>
				</DrawerHeader>
				<DrawerFooter>
					<ButtonLink to={linkToDialog('migration-assistant')} variant='primary' size='dialog'>
						{t('migration-assistant.mobile.start-button')}
					</ButtonLink>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}
