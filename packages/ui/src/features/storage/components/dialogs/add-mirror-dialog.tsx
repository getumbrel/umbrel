import {Trans, useTranslation} from 'react-i18next'
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

type AddMirrorDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** The two unpooled drives to add as a mirrored pair */
	devices: [StorageDevice, StorageDevice] | null
	addMirrorAsync: (params: {deviceIds: [string, string]}) => Promise<boolean>
}

// Confirmation dialog for adding two new drives as a mirror pair to an HDD FailSafe array.
// Unlike raidz expansion this is instant: the new pair becomes usable storage immediately.
export function AddMirrorDialog({open, onOpenChange, devices, addMirrorAsync}: AddMirrorDialogProps) {
	const {t} = useTranslation()
	const {setPendingOperation, clearPendingOperation, setOperationError} = usePendingRaidOperation()

	const activeOperation = useActiveRaidOperation()
	const isOperationInProgress = !!activeOperation

	if (!devices) return null
	const [first, second] = devices

	// A mirror only provides the capacity of its smaller member
	const usableSize = Math.min(first.roundedSize, second.roundedSize)
	const sizesDiffer = first.roundedSize !== second.roundedSize

	const handleAdd = () => {
		if (!first.id || !second.id) return

		// Quick blocking RPC with no progress events - show the island for consistent UX
		setPendingOperation({type: 'expansion', state: 'adding', progress: 0})
		onOpenChange(false)

		addMirrorAsync({deviceIds: [first.id, second.id]})
			.then(() => {
				setPendingOperation({type: 'expansion', state: 'finished', progress: 100})
				setTimeout(() => clearPendingOperation(), 2000)
			})
			.catch((error) => {
				clearPendingOperation()
				setOperationError(error instanceof Error ? error.message : t('unknown-error'))
				toast.error(t('storage-manager.add-mirror.failed'), {area: 'settings'})
			})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogScrollableContent>
				<div className='flex flex-col gap-5 p-5'>
					<DialogHeader>
						<DialogTitle>{t('storage-manager.add-mirror.title')}</DialogTitle>
						<DialogDescription>{t('storage-manager.add-mirror.description')}</DialogDescription>
					</DialogHeader>

					{/* Drive summary */}
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

					{/* Capacity info */}
					<div className='flex flex-col gap-2 rounded-12 bg-white/6 p-4'>
						<p className='text-[13px] text-white/50'>
							<Trans
								t={t}
								i18nKey='storage-manager.add-mirror.info-capacity'
								values={{available: formatStorageSize(usableSize), protection: formatStorageSize(usableSize)}}
								components={{highlight: <Highlight />}}
							/>
						</p>
						{sizesDiffer && (
							<p className='text-[13px] text-yellow-500'>
								<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
								{t('storage-manager.add-mirror.sizes-differ', {
									size: formatStorageSize(usableSize),
								})}
							</p>
						)}
						<p className='text-[13px] text-yellow-500'>
							<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
							{t('storage-manager.add-drives-erase-warning')}
						</p>
					</div>

					{isOperationInProgress && <OperationInProgressBanner variant='wait' />}

					<DialogFooter>
						<Button variant='primary' size='dialog' onClick={handleAdd} disabled={isOperationInProgress}>
							{t('storage-manager.add-mirror.add-drives')}
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
