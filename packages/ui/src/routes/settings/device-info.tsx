import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {t} from '@/utils/i18n'

import {DeviceInfoContent} from './_components/device-info-content'

export default function DeviceInfoDialog() {
	const title = t('device-info')
	const dialogProps = useSettingsDialogProps()

	const {isLoading, data} = useDeviceInfo()

	// Don't show dialog because we don't know how big it will be until the content is loaded
	if (isLoading) {
		return null
	}

	const isUmbrelPro = data.umbrelHostEnvironment === 'umbrel-pro'

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent showClose={!isUmbrelPro}>
				<div className={isUmbrelPro ? 'space-y-6 px-5 pb-6' : 'space-y-6 px-5 py-6'}>
					{!isUmbrelPro && (
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
						</DialogHeader>
					)}
					<DeviceInfoContent
						umbrelHostEnvironment={data.umbrelHostEnvironment}
						device={data.device}
						modelNumber={data.modelNumber}
						serialNumber={data.serialNumber}
					/>
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}
