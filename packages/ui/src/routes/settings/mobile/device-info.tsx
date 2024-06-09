import {useDeviceInfo} from '@/hooks/use-device-info'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {t} from '@/utils/i18n'

import {DeviceInfoContent} from '../_components/device-info-content'

export function DeviceInfoDrawer() {
	const title = t('device-info')
	const dialogProps = useSettingsDialogProps()

	const {data, isLoading} = useDeviceInfo()

	if (isLoading) {
		return null
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('device-info-description')}</DrawerDescription>
				</DrawerHeader>
				<DrawerScroller>
					<DeviceInfoContent
						umbrelHostEnvironment={data.umbrelHostEnvironment}
						device={data.device}
						modelNumber={data.modelNumber}
						serialNumber={data.serialNumber}
					/>
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}
