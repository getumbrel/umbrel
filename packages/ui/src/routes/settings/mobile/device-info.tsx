import {useTranslation} from 'react-i18next'

import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {deviceInfoToHostEnvironment} from '@/hooks/use-device-info'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {trpcReact} from '@/trpc/trpc'

import {DeviceInfoContent, formatDeviceSpecs} from '../_components/device-info-content'

export function DeviceInfoDrawer() {
	const {t} = useTranslation()
	const title = t('device-info')
	const dialogProps = useSettingsDialogProps()

	const deviceQ = trpcReact.systemNg.device.getSpecs.useQuery()

	if (deviceQ.isLoading) {
		return null
	}

	const umbrelHostEnvironment = deviceInfoToHostEnvironment(deviceQ.data)

	const device = deviceQ.data?.device
	const modelNumber = deviceQ.data?.model
	const serialNumber = deviceQ.data?.serial
	const {cpu, memory, storage} = formatDeviceSpecs(deviceQ.data)

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('device-info-description')}</DrawerDescription>
				</DrawerHeader>
				<DrawerScroller>
					<DeviceInfoContent
						umbrelHostEnvironment={umbrelHostEnvironment}
						device={device}
						modelNumber={modelNumber}
						serialNumber={serialNumber}
						cpu={cpu}
						memory={memory}
						storage={storage}
					/>
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}
