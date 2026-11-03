import {useTranslation} from 'react-i18next'

import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {deviceInfoToHostEnvironment} from '@/hooks/use-device-info'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {trpcReact} from '@/trpc/trpc'

import {DeviceInfoContent, formatDeviceSpecs} from './_components/device-info-content'

export default function DeviceInfoDialog() {
	const {t} = useTranslation()
	const title = t('device-info')
	const dialogProps = useSettingsDialogProps()

	const deviceQ = trpcReact.systemNg.device.getSpecs.useQuery()
	const gpuQ = trpcReact.hardware.gpu.getInfo.useQuery()

	// Don't show dialog because we don't know how big it will be until the content is loaded
	if (deviceQ.isLoading) {
		return null
	}

	const umbrelHostEnvironment = deviceInfoToHostEnvironment(deviceQ.data)
	const isUmbrelPro = umbrelHostEnvironment === 'umbrel-pro'

	const device = deviceQ.data?.device
	const modelNumber = deviceQ.data?.model
	const serialNumber = deviceQ.data?.serial
	const {cpu, memory, storage} = formatDeviceSpecs(deviceQ.data)

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<div className={isUmbrelPro ? 'space-y-6 px-5 pb-6' : 'space-y-6 px-5 py-6'}>
					{isUmbrelPro ? (
						<DialogTitle className='sr-only'>{title}</DialogTitle>
					) : (
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
						</DialogHeader>
					)}
					<DeviceInfoContent
						umbrelHostEnvironment={umbrelHostEnvironment}
						device={device}
						modelNumber={modelNumber}
						serialNumber={serialNumber}
						cpu={cpu}
						memory={memory}
						storage={storage}
						gpus={gpuQ.data?.gpus}
					/>
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}
