import {DialogPortal} from '@radix-ui/react-dialog'
import {DropdownMenu} from '@radix-ui/react-dropdown-menu'
import {t} from 'i18next'
import {Suspense, useState} from 'react'
import {Route, Routes, useNavigate, useParams} from 'react-router-dom'

import {ImmersiveDialog, ImmersiveDialogOverlay} from '@/components/ui/immersive-dialog'
import {AppDropdown, ImmersivePickerDialogContentInit, ImmersivePickerItem} from '@/modules/immersive-picker'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {TroubleshootApp} from '@/routes/settings/troubleshoot/app'
import TroubleshootUmbrelOs from '@/routes/settings/troubleshoot/umbrelos'

export default function TroubleshootDialog() {
	const dialogProps = useSettingsDialogProps()

	return (
		<ImmersiveDialog {...dialogProps}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<Suspense>
					<Routes>
						<Route index path='/' Component={PickerDialogContent} />
						<Route path='/umbrelos/:systemTab?' Component={TroubleshootUmbrelOs} />
						<Route path='/app/:appId' Component={TroubleshootApp} />
					</Routes>
				</Suspense>
			</DialogPortal>
		</ImmersiveDialog>
	)
}

function PickerDialogContent() {
	const navigate = useNavigate()
	const [appDialogOpen, setAppDialogOpen] = useState(false)
	const params = useParams<{appId: string}>()

	return (
		<ImmersivePickerDialogContentInit title={t('troubleshoot-pick-title')}>
			<ImmersivePickerItem
				title={t('umbrelos')}
				description={t('troubleshoot.umbrelos-description')}
				to='/settings/troubleshoot/umbrelos/umbrelos'
			/>
			<ImmersivePickerItem
				title={t('troubleshoot.app')}
				description={t('troubleshoot.app-description')}
				onClick={() => setAppDialogOpen(true)}
			>
				<DropdownMenu open={appDialogOpen} onOpenChange={setAppDialogOpen}>
					<AppDropdown
						open={appDialogOpen}
						onOpenChange={setAppDialogOpen}
						appId={params.appId}
						setAppId={(appId) => navigate(`/settings/troubleshoot/app/${appId}`)}
					/>
				</DropdownMenu>
			</ImmersivePickerItem>
		</ImmersivePickerDialogContentInit>
	)
}
