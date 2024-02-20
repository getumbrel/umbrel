import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {DeviceInfoContent} from './_components/device-info-content'

export default function DeviceInfoDialog() {
	const title = t('device-info-long')
	const dialogProps = useDialogOpenProps('device-info')

	const {isLoading, data} = useDeviceInfo()

	// Don't show dialog because we don't know how big it will be until the content is loaded
	if (isLoading) {
		return null
	}

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent className='p-0'>
					<DialogCloseButton className='absolute right-2 top-2 z-50' />
					<div className='umbrel-dialog-fade-scroller space-y-6 overflow-y-auto px-5 py-6'>
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
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
