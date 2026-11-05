import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {TbAlertTriangle, TbArrowRight, TbCircleCheckFilled, TbPlus} from 'react-icons/tb'

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

import {FailsafeTransitionPlan, formatStorageSize} from '../../utils'
import {OperationInProgressBanner} from './operation-in-progress-banner'

type EnableFailsafeDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	plan: FailsafeTransitionPlan
	/** Current usable pool space, which stays the same after the transition */
	availableBytes: number
	transitionToFailsafeMirrorAsync: (params: {
		pairs: {existingDeviceId: string; newDeviceId: string}[]
		acceleratorDeviceId?: string
	}) => Promise<boolean>
}

// Storage -> FailSafe transition for HDD arrays. Every pool drive gets mirrored onto a new
// drive; the pool stays online and fully usable while data syncs in the background.
export function EnableFailsafeDialog({
	open,
	onOpenChange,
	plan,
	availableBytes,
	transitionToFailsafeMirrorAsync,
}: EnableFailsafeDialogProps) {
	const {t} = useTranslation()
	const {setPendingOperation, clearPendingOperation, setOperationError} = usePendingRaidOperation()

	const activeOperation = useActiveRaidOperation()
	const isOperationInProgress = !!activeOperation

	const handleEnable = () => {
		if (!plan.satisfied) return

		const pairs = plan.pairs.flatMap((pair) =>
			pair.existingDevice.id && pair.newDevice?.id
				? [{existingDeviceId: pair.existingDevice.id, newDeviceId: pair.newDevice.id}]
				: [],
		)
		if (pairs.length !== plan.pairs.length) return

		// Transition is non-blocking - show island immediately, backend streams rebuild progress
		setPendingOperation({type: 'failsafe-transition', state: 'starting', progress: 0})
		onOpenChange(false)

		transitionToFailsafeMirrorAsync({
			pairs,
			acceleratorDeviceId: plan.acceleratorNewDevice?.id,
		}).catch((error) => {
			clearPendingOperation()
			setOperationError(error instanceof Error ? error.message : t('unknown-error'))
			toast.error(t('storage-manager.enable-failsafe.failed'), {area: 'settings'})
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogScrollableContent>
				<div className='flex flex-col gap-5 p-5'>
					<DialogHeader>
						<div className='flex items-center gap-2'>
							<IoShieldHalf className='size-5' />
							<DialogTitle>{t('storage-manager.enable-failsafe.title')}</DialogTitle>
						</div>
						<DialogDescription>{t('storage-manager.enable-failsafe.description')}</DialogDescription>
					</DialogHeader>

					{/* Pairing plan: each pool drive and the new drive that will mirror it */}
					<div className='flex flex-col divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						{plan.pairs.map((pair) => (
							<div key={pair.existingDevice.id} className='flex items-center gap-3 px-3 py-2.5'>
								<div className='min-w-0 flex-1'>
									<div className='truncate text-[13px] font-medium text-white'>{pair.existingDevice.name}</div>
									<div className='truncate text-[12px] text-white/50'>
										{formatStorageSize(pair.existingDevice.size)} · {pair.existingDevice.serial}
									</div>
								</div>
								<TbArrowRight className='size-4 shrink-0 text-white/40' />
								{pair.newDevice ? (
									<div className='flex min-w-0 flex-1 items-center gap-2'>
										<TbCircleCheckFilled className='size-4 shrink-0 text-brand' />
										<div className='min-w-0'>
											<div className='truncate text-[13px] font-medium text-white'>{pair.newDevice.name}</div>
											<div className='truncate text-[12px] text-white/50'>
												{formatStorageSize(pair.newDevice.size)} · {pair.newDevice.serial}
											</div>
										</div>
									</div>
								) : (
									<div className='flex min-w-0 flex-1 items-center gap-2 text-white/40'>
										<TbPlus className='size-4 shrink-0' />
										<span className='truncate text-[13px] font-medium'>
											{t('storage-manager.enable-failsafe.attach-drive', {
												size: formatStorageSize(pair.requiredSize),
											})}
										</span>
									</div>
								)}
							</div>
						))}

						{/* Accelerator mirror requirement (only when the pool has an accelerator) */}
						{plan.acceleratorRequiredSize !== undefined && (
							<div className='flex items-center gap-3 px-3 py-2.5'>
								<div className='min-w-0 flex-1'>
									<div className='truncate text-[13px] font-medium text-white'>
										{t('storage-manager.enable-failsafe.accelerator')}
									</div>
									<div className='truncate text-[12px] text-white/50'>
										{formatStorageSize(plan.acceleratorRequiredSize)}
									</div>
								</div>
								<TbArrowRight className='size-4 shrink-0 text-white/40' />
								{plan.acceleratorNewDevice ? (
									<div className='flex min-w-0 flex-1 items-center gap-2'>
										<TbCircleCheckFilled className='size-4 shrink-0 text-brand' />
										<div className='min-w-0'>
											<div className='truncate text-[13px] font-medium text-white'>
												{plan.acceleratorNewDevice.name}
											</div>
											<div className='truncate text-[12px] text-white/50'>
												{formatStorageSize(plan.acceleratorNewDevice.size)} · {plan.acceleratorNewDevice.serial}
											</div>
										</div>
									</div>
								) : (
									<div className='flex min-w-0 flex-1 items-center gap-2 text-white/40'>
										<TbPlus className='size-4 shrink-0' />
										<span className='truncate text-[13px] font-medium'>
											{t('storage-manager.enable-failsafe.attach-ssd', {
												size: formatStorageSize(plan.acceleratorRequiredSize),
											})}
										</span>
									</div>
								)}
							</div>
						)}
					</div>

					{/* What happens */}
					<div className='flex flex-col gap-2 rounded-12 bg-white/6 p-4'>
						<p className='text-[13px] text-white/50'>
							{t('storage-manager.enable-failsafe.info-capacity', {available: formatStorageSize(availableBytes)})}
						</p>
						<p className='text-[13px] text-white/50'>{t('storage-manager.enable-failsafe.info-background')}</p>
						<p className='text-[13px] text-yellow-500'>
							<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
							{t('storage-manager.add-drives-erase-warning')}
						</p>
					</div>

					{isOperationInProgress && <OperationInProgressBanner variant='wait' />}

					<DialogFooter>
						<Button
							variant='primary'
							size='dialog'
							onClick={handleEnable}
							disabled={!plan.satisfied || isOperationInProgress}
						>
							{t('storage-manager.enable-failsafe.enable')}
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
