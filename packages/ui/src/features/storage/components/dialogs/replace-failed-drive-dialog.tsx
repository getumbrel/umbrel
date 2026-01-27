import {Trans} from 'react-i18next/TransWithoutContext'
import {TbAlertTriangle, TbCircleCheckFilled} from 'react-icons/tb'

import {toast} from '@/components/ui/toast'
import {usePendingRaidOperation} from '@/features/storage/contexts/pending-operation-context'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {t} from '@/utils/i18n'

import {getDeviceHealth, StorageDevice} from '../../hooks/use-storage'
import {formatStorageSize} from '../../utils'

const Highlight = ({children}: {children?: React.ReactNode}) => <span className='text-white'>{children}</span>

type FailedRaidDevice = {
	id: string
	status: string
	readErrors: number
	writeErrors: number
	checksumErrors: number
}

type ReplaceFailedDriveDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** The new physical device to use as replacement */
	newDevice: StorageDevice | null
	/** The failed RAID device to replace */
	failedDevice: FailedRaidDevice | null
	/** Minimum rounded size in the current RAID array (for size validation) */
	minRoundedDriveSize: number
	replaceDeviceAsync: (params: {oldDevice: string; newDevice: string}) => Promise<boolean>
}

export function ReplaceFailedDriveDialog({
	open,
	onOpenChange,
	newDevice,
	failedDevice,
	minRoundedDriveSize,
	replaceDeviceAsync,
}: ReplaceFailedDriveDialogProps) {
	const {setPendingOperation, clearPendingOperation} = usePendingRaidOperation()

	if (!newDevice || !failedDevice) return null

	// Size validation: new device must be at least as large as the smallest device in the array
	const isDeviceTooSmall = minRoundedDriveSize > 0 && (newDevice.roundedSize ?? newDevice.size) < minRoundedDriveSize

	const {hasWarning} = getDeviceHealth(newDevice)

	const handleReplace = () => {
		if (!newDevice?.id || !failedDevice?.id) return

		// Replace is non-blocking - show island immediately
		setPendingOperation({
			type: 'replace',
			state: 'starting',
			progress: 0,
		})
		onOpenChange(false)

		replaceDeviceAsync({
			oldDevice: failedDevice.id,
			newDevice: newDevice.id,
		}).catch((error) => {
			clearPendingOperation()
			toast.error(t('storage-manager.replace-failed.error'), {
				description: error instanceof Error ? error.message : t('unknown-error'),
			})
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogScrollableContent>
				<div className='flex select-none flex-col gap-5 p-5'>
					<DialogHeader>
						<DialogTitle>{t('storage-manager.replace-failed.title')}</DialogTitle>
						<DialogDescription>{t('storage-manager.replace-failed.description')}</DialogDescription>
					</DialogHeader>

					{/* Degraded warning banner */}
					<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
						<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
						<div className='flex flex-col gap-1'>
							<span className='text-13 font-semibold text-destructive2'>
								{t('storage-manager.replace-failed.degraded')}
							</span>
							<span className='text-12 text-white/60'>{t('storage-manager.replace-failed.degraded-description')}</span>
						</div>
					</div>

					{/* New SSD summary */}
					<div className='flex flex-col divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						<div className='flex items-center justify-between gap-2 px-3 py-2.5'>
							<div className='flex items-center gap-2'>
								{hasWarning ? (
									<TbAlertTriangle className='size-5 text-[#F5A623]' />
								) : (
									<TbCircleCheckFilled className='size-5 text-brand' />
								)}
								{/* "SSD" and "Slot" labels are not translated as they match physical device markings */}
								<span className='text-[13px] font-medium text-white/60'>
									<Trans
										i18nKey='storage-manager.replace-failed.ssd-in-slot'
										values={{size: formatStorageSize(newDevice.size), slot: newDevice.slot}}
										components={{highlight: <Highlight />}}
									/>
								</span>
							</div>
						</div>
					</div>

					{/* Size validation warning */}
					{isDeviceTooSmall ? (
						<div className='flex items-start gap-3 rounded-12 bg-[#F5A623]/10 p-3'>
							<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-[#F5A623]' />
							<div className='flex flex-col gap-1'>
								<span className='text-13 font-semibold text-[#F5A623]'>
									{t('storage-manager.replace-failed.too-small')}
								</span>
								<span className='text-12 text-white/60'>
									{t('storage-manager.replace-failed.too-small-description', {
										deviceSize: formatStorageSize(newDevice.size),
										minSize: formatStorageSize(minRoundedDriveSize),
									})}
								</span>
							</div>
						</div>
					) : (
						/* What happens next */
						<div className='flex flex-col gap-2'>
							<span className='text-13 font-medium text-white/60'>
								{t('storage-manager.replace-failed.what-happens')}
							</span>
							<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
								{[
									t('storage-manager.replace-failed.step-rebuild'),
									t('storage-manager.replace-failed.step-time'),
									t('storage-manager.replace-failed.step-protected'),
								].map((step, index) => (
									<div key={index} className='flex items-center gap-3 p-3 text-12 font-medium -tracking-3'>
										<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
											{index + 1}
										</span>
										<span>{step}</span>
									</div>
								))}
							</div>
						</div>
					)}

					<DialogFooter>
						<Button variant='primary' onClick={handleReplace} disabled={isDeviceTooSmall}>
							{t('storage-manager.replace-failed.replace-now')}
						</Button>
						<Button variant='default' onClick={() => onOpenChange(false)}>
							{t('cancel')}
						</Button>
					</DialogFooter>
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}
