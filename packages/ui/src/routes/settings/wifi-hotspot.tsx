import {
	WifiHotspotDrawerOrDialog,
	WifiHotspotDrawerOrDialogContent,
} from '@/modules/wifi-hotspot/wifi-hotspot-drawer-or-dialog'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'

export default function WifiHotspot() {
	const dialogProps = useSettingsDialogProps()

	return (
		<WifiHotspotDrawerOrDialog {...dialogProps}>
			<WifiHotspotDrawerOrDialogContent />
		</WifiHotspotDrawerOrDialog>
	)
}
