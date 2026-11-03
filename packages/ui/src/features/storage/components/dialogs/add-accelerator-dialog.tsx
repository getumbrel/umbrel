import {useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbCircleCheckFilled, TbHelpCircle} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/components/ui/dialog'
import {toast} from '@/components/ui/toast'
import {useActiveRaidOperation} from '@/features/storage/hooks/use-active-raid-operation'
import {usePendingRaidOperation} from '@/features/storage/providers/pending-operation-context'

import {getDeviceHealth, StorageDevice} from '../../hooks/use-storage'
import {formatStorageSize} from '../../utils'
import {OperationInProgressBanner} from './operation-in-progress-banner'

const Highlight = ({children}: {children?: React.ReactNode}) => <span className='text-white'>{children}</span>

type AddAcceleratorDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** One SSD in Full Storage mode, two in FailSafe mode (backend enforces the count) */
	devices: StorageDevice[] | null
	addAcceleratorAsync: (params: {deviceIds: string[]}) => Promise<boolean>
}

// Confirmation dialog for adding SSD acceleration to an HDD array
export function AddAcceleratorDialog({open, onOpenChange, devices, addAcceleratorAsync}: AddAcceleratorDialogProps) {
	const {t} = useTranslation()
	const {setPendingOperation, clearPendingOperation, setOperationError} = usePendingRaidOperation()

	const activeOperation = useActiveRaidOperation()
	const isOperationInProgress = !!activeOperation

	if (!devices || devices.length === 0) return null

	const isPair = devices.length === 2
	const sizesDiffer = isPair && devices[0].roundedSize !== devices[1].roundedSize
	const smallestSize = Math.min(...devices.map((device) => device.roundedSize))

	const handleAdd = () => {
		const deviceIds = devices.map((device) => device.id).filter((id): id is string => id !== undefined)
		if (deviceIds.length !== devices.length) return

		// Quick blocking RPC with no progress events - show the island for consistent UX
		setPendingOperation({type: 'expansion', state: 'adding', progress: 0})
		onOpenChange(false)

		addAcceleratorAsync({deviceIds})
			.then(() => {
				setPendingOperation({type: 'expansion', state: 'finished', progress: 100})
				setTimeout(() => clearPendingOperation(), 2000)
			})
			.catch((error) => {
				clearPendingOperation()
				setOperationError(error instanceof Error ? error.message : t('unknown-error'))
				toast.error(t('storage-manager.add-accelerator.failed'), {area: 'settings'})
			})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogScrollableContent>
				<div className='flex flex-col gap-5 p-5'>
					<DialogHeader>
						<DialogTitle>{t('storage-manager.add-accelerator.title')}</DialogTitle>
						<DialogDescription>{t('storage-manager.ssd-acceleration.description')}</DialogDescription>
					</DialogHeader>

					{/* SSD summary */}
					<div className='flex flex-col divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						{devices.map((device) => {
							const {hasWarning} = getDeviceHealth(device)
							return (
								<div key={device.id} className='flex items-center justify-between gap-2 px-3 py-2.5'>
									<div className='flex items-center gap-2'>
										{hasWarning ? (
											<TbAlertTriangle className='size-5 text-[#F5A623]' />
										) : (
											<>
												{device.smartStatus === 'healthy' ? (
													<TbCircleCheckFilled className='size-5 text-brand' />
												) : (
													<TbHelpCircle className='size-5 text-white/40' aria-label={t('storage-status.unknown')} />
												)}
											</>
										)}
										<span className='text-[13px] font-medium text-white/60'>
											<Highlight>{formatStorageSize(device.size)}</Highlight> · {device.model}
										</span>
									</div>
								</div>
							)
						})}
					</div>

					{/* Notes */}
					<div className='flex flex-col gap-2 rounded-12 bg-white/6 p-4'>
						<p className='text-[13px] text-white/50'>
							{isPair
								? t('storage-manager.add-accelerator.info-pair')
								: t('storage-manager.add-accelerator.info-single')}
						</p>
						{sizesDiffer && (
							<p className='text-[13px] text-yellow-500'>
								<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
								{t('storage-manager.add-accelerator.sizes-differ', {size: formatStorageSize(smallestSize)})}
							</p>
						)}
						<p className='text-[13px] text-yellow-500'>
							<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
							{isPair ? t('storage-manager.add-drives-erase-warning') : t('storage-manager.add-drive-erase-warning')}
						</p>
					</div>

					{isOperationInProgress && <OperationInProgressBanner variant='wait' />}

					<DialogFooter>
						<Button variant='primary' size='dialog' onClick={handleAdd} disabled={isOperationInProgress}>
							{t('storage-manager.ssd-acceleration.enable')}
						</Button>
						<Button variant='default' size='dialog' onClick={() => onOpenChange(false)}>
							{t('cancel')}
						</Button>
					</DialogFooter>
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}
