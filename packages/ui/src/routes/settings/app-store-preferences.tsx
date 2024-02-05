import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {useDialogOpenProps} from '@/utils/dialog'

import {AppStorePreferencesContent} from './_components/app-store-preferences-content'

export default function AppStorePreferencesDialog() {
	const title = 'App Store Preferences'
	useUmbrelTitle(title)

	const dialogProps = useDialogOpenProps('app-store-preferences')

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent className='p-0'>
					<div className='umbrel-dialog-fade-scroller space-y-6 overflow-y-auto px-5 py-6'>
						<DialogHeader>
							<DialogTitle>App store</DialogTitle>
						</DialogHeader>
						<AppStorePreferencesContent />
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
