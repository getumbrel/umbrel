import {DialogPortal} from '@radix-ui/react-dialog'
import {DropdownMenu} from '@radix-ui/react-dropdown-menu'
import {t} from 'i18next'
import {Suspense, useState} from 'react'
import {Route, Routes, useNavigate, useParams} from 'react-router-dom'

import {ImmersiveDialog, ImmersiveDialogOverlay} from '@/components/ui/immersive-dialog'
import {AppDropdown, ImmersivePickerDialogContentInit, ImmersivePickerItem} from '@/modules/immersive-picker'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'

import {App} from './app'
import UmbrelOs from './umbrelos'

export default function TerminalDialog() {
	const dialogProps = useSettingsDialogProps()

	return (
		<ImmersiveDialog {...dialogProps}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<Suspense>
					<Routes>
						<Route index path='/' Component={PickerDialogContent} />
						<Route path='/umbrelos' Component={UmbrelOs} />
						<Route path='/app/:appId' Component={App} />
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
		<ImmersivePickerDialogContentInit title={t('terminal')}>
			<ImmersivePickerItem
				title={t('umbrelos')}
				description={t('terminal.umbrelos-description')}
				to='/settings/terminal/umbrelos'
			/>
			<ImmersivePickerItem
				title={t('terminal.app')}
				description={t('terminal.app-description')}
				onClick={() => setAppDialogOpen(true)}
			>
				<DropdownMenu open={appDialogOpen} onOpenChange={setAppDialogOpen}>
					<AppDropdown
						open={appDialogOpen}
						onOpenChange={setAppDialogOpen}
						appId={params.appId}
						setAppId={(appId) => navigate(`/settings/terminal/app/${appId}`)}
					/>
				</DropdownMenu>
			</ImmersivePickerItem>
		</ImmersivePickerDialogContentInit>
	)
}
