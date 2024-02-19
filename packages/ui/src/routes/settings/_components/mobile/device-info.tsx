import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {DeviceInfoContent} from '../device-info-content'

export function DeviceInfoDrawer() {
	const title = t('device-info-short')
	const dialogProps = useDialogOpenProps('device-info')

	const {data, isLoading} = useDeviceInfo()

	if (isLoading) {
		return null
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('device-info-description')}</DrawerDescription>
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
