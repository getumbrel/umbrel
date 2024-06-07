import {WifiDrawerOrDialog, WifiDrawerOrDialogContent} from '@/modules/wifi/wifi-drawer-or-dialog'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'

export default function Wifi() {
	const dialogProps = useSettingsDialogProps()

	return (
		<WifiDrawerOrDialog {...dialogProps}>
			<WifiDrawerOrDialogContent />
		</WifiDrawerOrDialog>
	)
}
