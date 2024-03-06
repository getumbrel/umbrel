import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/shadcn-components/ui/dialog'
import {t} from '@/utils/i18n'

import {DeviceInfoContent} from './_components/device-info-content'

export default function DeviceInfoDialog() {
	const title = t('device-info-long')
	const dialogProps = useSettingsDialogProps()

	const {isLoading, data} = useDeviceInfo()

	// Don't show dialog because we don't know how big it will be until the content is loaded
	if (isLoading) {
		return null
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent showClose>
				<div className='space-y-6 px-5 py-6'>
					<DialogHeader>
						<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
						<DialogTitle>{title}</DialogTitle>
					</DialogHeader>
					<DeviceInfoContent
						umbrelHostEnvironment={data.umbrelHostEnvironment}
						osVersion={data.osVersion}
						modelNumber={data.modelNumber}
						serialNumber={data.serialNumber}
					/>
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}
