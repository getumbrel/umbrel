import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {useDialogOpenProps} from '@/utils/dialog'

import {useDeviceInfo} from '../../hooks/use-device-info'
import {DeviceInfoContent} from './_components/device-info-content'

export default function DeviceInfoDialog() {
	const title = 'Device Information'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('device-info')

	const {isLoading, data} = useDeviceInfo()

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
							<DialogTitle>{title}</DialogTitle>
						</DialogHeader>
						<DeviceInfoContent
							device={data.device}
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
