import {useEffect, useState} from 'react'
import {Trans} from 'react-i18next/TransWithoutContext'
import {IoShieldHalf} from 'react-icons/io5'
import {TbAlertTriangle, TbCircleCheckFilled} from 'react-icons/tb'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/components/ui/dialog'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {useActiveRaidOperation} from '@/features/storage/hooks/use-active-raid-operation'
import {usePendingRaidOperation} from '@/features/storage/providers/pending-operation-context'
import {t} from '@/utils/i18n'

import {getDeviceHealth, RaidDevice, StorageDevice} from '../../hooks/use-storage'
import {formatStorageSize} from '../../utils'
import {StorageDonutChart} from '../storage-donut-chart'
import {OperationInProgressBanner} from './operation-in-progress-banner'

// --- Info Text Component ---

const Highlight = ({children}: {children?: React.ReactNode}) => <span className='text-white'>{children}</span>

const WastedText = ({children}: {children?: React.ReactNode}) => <span className='text-[#F5A623]'>{children}</span>

type InfoTextProps = {
	showFailSafeOption: boolean
	effectiveMode: 'storage' | 'failsafe' | undefined
	newDrivesRawBytes: number
	newToAvailable: number
	newToProtection: number
	newToWasted: number
	additionalFailsafeUsable: number
	additionalStorageCapacity: number
	failsafeWasted: number
}

function InfoText({
	showFailSafeOption,
	effectiveMode,
	newDrivesRawBytes,
	newToAvailable,
	newToProtection,
	newToWasted,
	additionalFailsafeUsable,
	additionalStorageCapacity,
	failsafeWasted,
}: InfoTextProps) {
	const newSize = formatStorageSize(newDrivesRawBytes)

	// Shared components for Trans
	const transComponents = {
		highlight: <Highlight />,
		wasted: <WastedText />,
	}

	// Storage mode (no protection)
	if (effectiveMode !== 'failsafe') {
		const availableSize = formatStorageSize(showFailSafeOption ? newDrivesRawBytes : additionalStorageCapacity)
		return (
			<div className='flex flex-col gap-2'>
				<p className='text-[13px] text-white/50'>
					<Trans
						i18nKey='storage-manager.add-to-raid.info-capacity-added'
						values={{size: availableSize}}
						components={transComponents}
					/>
					{showFailSafeOption && ` ${t('storage-manager.add-to-raid.info-no-protection')}`}
				</p>
				{showFailSafeOption && (
					<p className='text-[13px] text-yellow-500'>
						<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
						{t('storage-manager.add-to-raid.warning-failsafe-now-only')}
					</p>
				)}
			</div>
		)
	}

	// FailSafe mode - choosing mode (transitioning from storage)
	if (showFailSafeOption) {
		if (newToAvailable > 0) {
			return (
				<p className='text-[13px] text-white/50'>
					<Trans
						i18nKey='storage-manager.add-to-raid.info-capacity-adds-both'
						values={{
							size: newSize,
							available: formatStorageSize(newToAvailable),
							protection: formatStorageSize(newToProtection),
						}}
						components={transComponents}
					/>{' '}
					{newToWasted > 0 && (
						<>
							<Trans
								i18nKey='storage-manager.add-to-raid.info-wasted'
								values={{size: formatStorageSize(newToWasted)}}
								components={transComponents}
							/>{' '}
						</>
					)}
					{t('storage-manager.add-to-raid.info-data-safe')}
				</p>
			)
		}
		// New drives go entirely to protection
		return (
			<p className='text-[13px] text-white/50'>
				{newToWasted > 0 ? (
					<>
						<Trans
							i18nKey='storage-manager.add-to-raid.info-capacity-protection-only'
							values={{size: newSize, protection: formatStorageSize(newToProtection)}}
							components={transComponents}
						/>{' '}
						<Trans
							i18nKey='storage-manager.add-to-raid.info-wasted'
							values={{size: formatStorageSize(newToWasted)}}
							components={transComponents}
						/>
					</>
				) : (
					<Trans
						i18nKey='storage-manager.add-to-raid.info-capacity-protection-only-full'
						values={{size: newSize}}
						components={transComponents}
					/>
				)}{' '}
				{t('storage-manager.add-to-raid.info-data-safe')}
			</p>
		)
	}

	// FailSafe mode - already in failsafe, just adding
	return (
		<p className='text-[13px] text-white/50'>
			<Trans
				i18nKey='storage-manager.add-to-raid.info-capacity-adds-available'
				values={{
					size: newSize,
					available: formatStorageSize(additionalFailsafeUsable),
				}}
				components={transComponents}
			/>
			{failsafeWasted > 0 && (
				<>
					{' '}
					<Trans
						i18nKey='storage-manager.add-to-raid.info-total-wasted'
						values={{size: formatStorageSize(failsafeWasted)}}
						components={transComponents}
					/>
				</>
			)}
		</p>
	)
}

// --- Add to RAID Dialog Component ---
// TODO: Currently limited to adding 1 SSD at a time due to ZFS raidz1 expansion limitations.
// When backend supports adding multiple SSDs at once, update this dialog to handle multiple devices.

type AddToRaidDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	device: StorageDevice | null
	canChooseMode: boolean
	raidType?: 'storage' | 'failsafe'
	raidDevices: RaidDevice[] // Devices currently in the RAID array
	addDeviceAsync: (params: {device: string}) => Promise<boolean>
	transitionToFailsafeAsync: (params: {device: string}) => Promise<boolean>
}

export function AddToRaidDialog({
	open,
	onOpenChange,
	device,
	canChooseMode,
	raidType,
	raidDevices,
	addDeviceAsync,
	transitionToFailsafeAsync,
}: AddToRaidDialogProps) {
	// State for FailSafe toggle and confirmation dialog
	const [failSafeEnabled, setFailSafeEnabled] = useState(false)
	const [showRestartConfirmation, setShowRestartConfirmation] = useState(false)

	// Context for showing island immediately for non-blocking operations
	const {setPendingOperation, clearPendingOperation} = usePendingRaidOperation()

	// Check if a RAID operation is already in progress
	const activeOperation = useActiveRaidOperation()
	const isOperationInProgress = !!activeOperation

	// Get existing RAID devices - these are the devices actually in the RAID array
	// (not to be confused with all detected devices)
	const existingCount = raidDevices.length
	const existingRoundedSizes = raidDevices.map((d) => d.roundedSize)
	const existingSmallestRounded = existingRoundedSizes.length > 0 ? Math.min(...existingRoundedSizes) : 0

	// Size validation for ZFS operations (using roundedSize for consistency with backend partitioning):
	// - Failsafe mode add: new device must be >= smallest device in array
	// - Transition to failsafe: new device must be >= the current single device
	// - Storage mode add: no size restriction
	const newDeviceRoundedSize = device?.roundedSize ?? 0
	const isDeviceTooSmallForFailsafe = existingSmallestRounded > 0 && newDeviceRoundedSize < existingSmallestRounded

	// Calculate projected capacities after adding the new device (using roundedSize)
	const allRoundedSizes = device ? [...existingRoundedSizes, newDeviceRoundedSize] : existingRoundedSizes
	const totalRoundedBytes = allRoundedSizes.reduce((sum, size) => sum + size, 0)
	const smallestRoundedSize = allRoundedSizes.length > 0 ? Math.min(...allRoundedSizes) : 0
	const driveCount = allRoundedSizes.length

	// Check if all drives have the same roundedSize (no wasted space)
	const allSameSize = allRoundedSizes.length > 0 && allRoundedSizes.every((s) => s === smallestRoundedSize)

	// Reset state when dialog opens
	// allSameSize intentionally excluded from deps - we only reset state on dialog open, not when sizes change
	useEffect(() => {
		if (open) {
			setFailSafeEnabled(allSameSize)
			setShowRestartConfirmation(false)
		}
	}, [open])

	// Early return after all hooks
	if (!device) return null

	// Calculate capacity for each mode (after adding) - using roundedSize for failsafe calculations
	const storageCapacity = totalRoundedBytes
	const failsafeUsable = driveCount > 1 ? smallestRoundedSize * (driveCount - 1) : 0
	const failsafeProtection = smallestRoundedSize
	const failsafeWasted = Math.max(0, totalRoundedBytes - failsafeUsable - failsafeProtection)

	// Calculate current capacity (before adding)
	const currentFailsafeUsable = existingCount > 1 ? existingSmallestRounded * (existingCount - 1) : 0
	const existingAvailable = existingRoundedSizes.reduce((sum, size) => sum + size, 0)

	// Calculate what the new drive adds
	const additionalStorageCapacity = newDeviceRoundedSize
	const additionalFailsafeUsable = failsafeUsable - currentFailsafeUsable

	// For canChooseMode: calculate where the new drive's capacity goes
	const newToAvailable = Math.max(0, failsafeUsable - existingAvailable)
	const newToProtection = failsafeProtection
	const newToWasted = failsafeWasted

	// Determine what to show based on canChooseMode and toggle
	const showFailSafeOption = canChooseMode
	const effectiveMode = canChooseMode ? (failSafeEnabled ? 'failsafe' : 'storage') : raidType

	// Block operation if device is too small for the selected/required mode
	const isBlockedBySize =
		(raidType === 'failsafe' && isDeviceTooSmallForFailsafe) || // Adding to existing failsafe
		(canChooseMode && failSafeEnabled && isDeviceTooSmallForFailsafe) // Transitioning to failsafe

	// Chart data based on effective mode
	const chartUsed = 0 // No used space yet for preview
	const chartAvailable = effectiveMode === 'failsafe' ? failsafeUsable / 1e12 : storageCapacity / 1e12
	const chartFailsafe = effectiveMode === 'failsafe' ? failsafeProtection / 1e12 : 0
	const chartWasted = effectiveMode === 'failsafe' ? failsafeWasted / 1e12 : 0

	// Execute the actual add operation
	// All modes use the floating island for consistent UX
	const executeAddDevice = (useFailsafe: boolean) => {
		if (!device?.id || !device.slot) return

		setShowRestartConfirmation(false)

		if (useFailsafe) {
			// Failsafe transition: non-blocking - we show island immediately
			setPendingOperation({
				type: 'failsafe-transition',
				state: 'starting',
				progress: 0,
			})
			onOpenChange(false)

			transitionToFailsafeAsync({device: device.id}).catch((error) => {
				clearPendingOperation()
				toast.error(t('storage-manager.add-to-raid.failed-enable-failsafe'), {
					description: error instanceof Error ? error.message : t('unknown-error'),
				})
			})
		} else if (raidType === 'failsafe') {
			// Adding to existing failsafe: non-blocking expansion - we show island immediately
			setPendingOperation({
				type: 'expansion',
				state: 'starting',
				progress: 0,
			})
			onOpenChange(false)

			addDeviceAsync({device: device.id}).catch((error) => {
				clearPendingOperation()
				toast.error(t('storage-manager.add-to-raid.failed-add'), {
					description: error instanceof Error ? error.message : t('unknown-error'),
				})
			})
		} else {
			// Storage mode add: blocking RPC with no progress events.
			// We still show the floating island (without percentage) for consistent UX across all
			// add operations. This lets us close the dialog immediately while giving visual feedback
			// that something is happening, rather than leaving the user wondering if their click worked or setting the UI in a loading state.
			setPendingOperation({
				type: 'expansion',
				state: 'adding',
				progress: 0,
			})
			onOpenChange(false)

			addDeviceAsync({device: device.id})
				.then(() => {
					// Show finished state briefly before island disappears
					setPendingOperation({
						type: 'expansion',
						state: 'finished',
						progress: 100,
					})
					setTimeout(() => clearPendingOperation(), 2000)
				})
				.catch((error) => {
					clearPendingOperation()
					toast.error(t('storage-manager.add-to-raid.failed-add'), {
						description: error instanceof Error ? error.message : t('unknown-error'),
					})
				})
		}
	}

	const handleAddDevice = () => {
		if (!device?.id || !device.slot) return

		// If failsafe is enabled (canChooseMode), show confirmation dialog first
		if (canChooseMode && failSafeEnabled) {
			setShowRestartConfirmation(true)
			return
		}

		// Otherwise proceed directly
		executeAddDevice(false)
	}

	const {hasWarning} = getDeviceHealth(device)

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							<DialogTitle>{t('storage-manager.add-to-raid.title')}</DialogTitle>
							<DialogDescription>{t('storage-manager.add-to-raid.description')}</DialogDescription>
						</DialogHeader>

						{/* SSD summary - "SSD" and "Slot" labels are not translated as they match physical device markings */}
						<div className='flex flex-col divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
							<div className='flex items-center justify-between gap-2 px-3 py-2.5'>
								<div className='flex items-center gap-2'>
									{hasWarning ? (
										<TbAlertTriangle className='size-5 text-[#F5A623]' />
									) : (
										<TbCircleCheckFilled className='size-5 text-brand' />
									)}
									<span className='text-[13px] font-medium text-white/60'>
										<Trans
											i18nKey='storage-manager.add-to-raid.ssd-in-slot'
											values={{size: formatStorageSize(device.size), slot: device.slot}}
											components={{highlight: <Highlight />}}
										/>
									</span>
								</div>
							</div>
						</div>

						{/* Capacity preview card */}
						<div className='flex flex-col gap-4 rounded-12 bg-white/6 p-4'>
							{/* FailSafe toggle - only when user can choose */}
							{showFailSafeOption && (
								<div className='flex items-center justify-between'>
									<div className='flex items-center gap-3'>
										<Switch checked={failSafeEnabled} onCheckedChange={setFailSafeEnabled} />
										<span className='text-[15px] text-white/85'>
											{t('storage-manager.add-to-raid.enable-failsafe')}
											{/* Mobile: inline text instead of pill to save space */}
											{allSameSize && (
												<span className='text-white/50 sm:hidden'>
													{' '}
													{t('storage-manager.add-to-raid.recommended-inline')}
												</span>
											)}
										</span>
									</div>
									{/* Desktop: pill on the right */}
									{allSameSize && (
										<div className='hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 sm:flex'>
											<IoShieldHalf className='size-4 text-white' />
											<span className='text-[13px] text-white'>{t('storage-manager.add-to-raid.recommended')}</span>
										</div>
									)}
								</div>
							)}

							{/* Info text and donut chart - hidden when size validation fails */}
							{!isBlockedBySize && (
								<InfoText
									showFailSafeOption={showFailSafeOption}
									effectiveMode={effectiveMode}
									newDrivesRawBytes={newDeviceRoundedSize}
									newToAvailable={newToAvailable}
									newToProtection={newToProtection}
									newToWasted={newToWasted}
									additionalFailsafeUsable={additionalFailsafeUsable}
									additionalStorageCapacity={additionalStorageCapacity}
									failsafeWasted={failsafeWasted}
								/>
							)}

							{/* Donut chart preview OR size warning */}
							{isBlockedBySize ? (
								<div className='flex items-start gap-3 rounded-12 bg-[#F5A623]/10 p-3'>
									<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-[#F5A623]' />
									<div className='flex flex-col gap-1'>
										<span className='text-13 font-semibold text-[#F5A623]'>
											{t('storage-manager.add-to-raid.too-small')}
										</span>
										<span className='text-12 text-white/60'>
											{t('storage-manager.add-to-raid.too-small-description', {
												deviceSize: formatStorageSize(device.size),
												minSize: formatStorageSize(existingSmallestRounded),
											})}
										</span>
									</div>
								</div>
							) : (
								<div className='flex items-center gap-4'>
									<StorageDonutChart
										used={chartUsed}
										available={chartAvailable}
										failsafe={chartFailsafe}
										wasted={chartWasted}
										hideCenter
									/>
									<div className='flex flex-col gap-1 text-[13px]'>
										<div className='flex items-center gap-2'>
											<span className='size-2 rounded-full bg-brand' />
											<span className='text-white/60'>
												{t('storage-manager.add-to-raid.available')}{' '}
												<span className='text-white'>
													{formatStorageSize(effectiveMode === 'failsafe' ? failsafeUsable : storageCapacity)}
												</span>
											</span>
										</div>
										{effectiveMode === 'failsafe' && (
											<>
												<div className='flex items-center gap-2'>
													<span
														className='size-2 rounded-full'
														style={{backgroundColor: 'color-mix(in srgb, hsl(var(--color-brand)), white 60%)'}}
													/>
													<span className='text-white/60'>
														{t('storage-manager.add-to-raid.failsafe-label')}{' '}
														<span className='text-white'>{formatStorageSize(failsafeProtection)}</span>
													</span>
												</div>
												{failsafeWasted > 0 && (
													<div className='flex items-center gap-2'>
														<span className='size-2 rounded-full bg-[#F5A623]' />
														<span className='text-white/60'>
															{t('storage-manager.add-to-raid.wasted-label')}{' '}
															<span className='text-white'>{formatStorageSize(failsafeWasted)}</span>
														</span>
													</div>
												)}
											</>
										)}
									</div>
								</div>
							)}
						</div>

						{isOperationInProgress && <OperationInProgressBanner variant='wait' />}

						<DialogFooter>
							<Button variant='primary' onClick={handleAddDevice} disabled={isBlockedBySize || isOperationInProgress}>
								{t('storage-manager.add-to-raid.add-ssd')}
							</Button>
							<Button variant='default' onClick={() => onOpenChange(false)}>
								{t('cancel')}
							</Button>
						</DialogFooter>
					</div>
				</DialogScrollableContent>
			</Dialog>

			{/* Confirmation dialog for failsafe transition - warns about restart */}
			<AlertDialog open={showRestartConfirmation} onOpenChange={setShowRestartConfirmation}>
				<AlertDialogContent>
					<AlertDialogHeader icon={IoShieldHalf}>
						<AlertDialogTitle>{t('storage-manager.add-to-raid.restart-required')}</AlertDialogTitle>
					</AlertDialogHeader>
					<div className='flex flex-col gap-3 text-14 leading-tight -tracking-3 text-white/75'>
						<p>{t('storage-manager.add-to-raid.restart-intro')}</p>
						<p>{t('storage-manager.add-to-raid.restart-during')}</p>
						<ul className='flex list-disc flex-col gap-1 pl-4'>
							<li>{t('storage-manager.add-to-raid.restart-active-tasks')}</li>
							<li>{t('storage-manager.add-to-raid.restart-ui-inaccessible')}</li>
						</ul>
						<p>{t('storage-manager.add-to-raid.restart-after')}</p>
					</div>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='primary'
							hideEnterIcon
							disabled={isOperationInProgress}
							onClick={(e) => {
								e.preventDefault()
								executeAddDevice(true)
							}}
						>
							{t('storage-manager.add-to-raid.understand-continue')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
