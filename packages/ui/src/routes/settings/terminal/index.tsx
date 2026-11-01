import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {DialogPortal} from '@/components/ui/dialog'
import {ImmersiveDialog, ImmersiveDialogOverlay} from '@/components/ui/immersive-dialog'
import {AppDropdown, ImmersivePickerDialogContentInit, ImmersivePickerItem} from '@/modules/immersive-picker'
import {usePickerTarget} from '@/modules/immersive-picker/target'
import {useDialogOpenProps} from '@/utils/dialog'

import {App} from './app'
import UmbrelOs from './umbrelos'

export default function TerminalDialog() {
	const dialogProps = useDialogOpenProps('terminal')
	const {target} = usePickerTarget('terminal')

	return (
		<ImmersiveDialog {...dialogProps}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				{target.type === 'picker' && <PickerDialogContent />}
				{target.type === 'umbrelos' && <UmbrelOs />}
				{target.type === 'app' && <App appId={target.appId} />}
			</DialogPortal>
		</ImmersiveDialog>
	)
}

function PickerDialogContent() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {linkToTarget} = usePickerTarget('terminal')
	const [appDialogOpen, setAppDialogOpen] = useState(false)

	return (
		<ImmersivePickerDialogContentInit title={t('terminal')}>
			<ImmersivePickerItem
				title={t('umbrelos')}
				description={t('terminal.umbrelos-description')}
				to={linkToTarget({type: 'umbrelos'})}
			/>
			<ImmersivePickerItem
				title={t('terminal.app')}
				description={t('terminal.app-description')}
				onClick={() => setAppDialogOpen(true)}
			>
				<AppDropdown
					open={appDialogOpen}
					onOpenChange={setAppDialogOpen}
					setAppId={(appId) => navigate(linkToTarget({type: 'app', appId}))}
				/>
			</ImmersivePickerItem>
		</ImmersivePickerDialogContentInit>
	)
}
