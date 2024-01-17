import {useDeviceInfo} from '@/hooks/use-device-info'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'

import {DeviceInfoContent} from '../device-info-content'

export function DeviceInfoDrawer() {
	const title = 'Device info'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('device-info')

	const {data, isLoading} = useDeviceInfo()

	if (isLoading) {
		return null
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Device type and current software version</DrawerDescription>
				</DrawerHeader>
				<DrawerScroller>
					<DeviceInfoContent
						umbrelHostEnvironment={data.umbrelHostEnvironment}
						osVersion={data.osVersion}
						modelNumber={data.modelNumber}
						serialNumber={data.serialNumber}
					/>
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}
