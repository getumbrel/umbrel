import {useTranslation} from 'react-i18next'

import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

import {AppStorePreferencesContent} from '../_components/app-store-preferences-content'

export function AppStorePreferencesDrawer() {
	const {t} = useTranslation()
	const title = t('settings.app-store-preferences.title')
	const dialogProps = useDialogOpenProps('app-store-preferences')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight withScroll>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('app-store.description')}</DrawerDescription>
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
