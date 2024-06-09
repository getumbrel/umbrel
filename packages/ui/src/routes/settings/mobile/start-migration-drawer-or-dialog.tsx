import {useState} from 'react'

import {useIsMobile} from '@/hooks/use-is-mobile'
import {MigrateImage} from '@/modules/migrate/migrate-image'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import MigrationAssistantDialog from '@/routes/settings/migration-assistant'
import {Button} from '@/shadcn-components/ui/button'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {t} from '@/utils/i18n'

export function StartMigrationDrawerOrDialog() {
	const title = t('migration-assistant')
	const dialogProps = useSettingsDialogProps()

	const isMobile = useIsMobile()
	const [startMigration, setStartMigration] = useState(isMobile ? false : true)

	if (startMigration) {
		return <MigrationAssistantDialog />
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader className='flex flex-col items-center text-center'>
					<div className='py-5'>
						<MigrateImage />
					</div>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('migration-assistant-description')}</DrawerDescription>
				</DrawerHeader>
				<DrawerFooter>
					<Button onClick={() => setStartMigration(true)} variant='primary' size='dialog'>
						{t('migration-assistant.mobile.start-button')}
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}
