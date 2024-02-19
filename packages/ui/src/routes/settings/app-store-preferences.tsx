import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {AppStorePreferencesContent} from './_components/app-store-preferences-content'

export default function AppStorePreferencesDialog() {
	const title = t('settings.app-store-preferences.title')

	const dialogProps = useDialogOpenProps('app-store-preferences')

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent className='p-0'>
					<div className='umbrel-dialog-fade-scroller space-y-6 overflow-y-auto px-5 py-6'>
						<DialogHeader>
							<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
							<DialogTitle>{t('app-store.title')}</DialogTitle>
						</DialogHeader>
						<AppStorePreferencesContent />
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
