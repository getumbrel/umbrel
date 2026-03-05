import {useState} from 'react'

import {Button} from '@/components/ui/button'
import {Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle} from '@/components/ui/drawer'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {MigrateImage} from '@/modules/migrate/migrate-image'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import MigrationAssistantDialog from '@/routes/settings/migration-assistant'
import {t} from '@/utils/i18n'

export function StartMigrationDrawerOrDialog() {
	const title = t('migration-assistant')
	const dialogProps = useSettingsDialogProps()
	const {deviceName} = useIsHomeOrPro()

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
					<DrawerDescription>{t('migration-assistant-description', {deviceName})}</DrawerDescription>
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
