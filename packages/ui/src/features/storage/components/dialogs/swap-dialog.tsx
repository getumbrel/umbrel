import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {TbAlertTriangle, TbInfoCircle} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/components/ui/dialog'
import {toast} from '@/components/ui/toast'
import {useActiveRaidOperation} from '@/features/storage/hooks/use-active-raid-operation'
import {usePendingRaidOperation} from '@/features/storage/providers/pending-operation-context'
import {cn} from '@/lib/utils'

import {RaidStatus, StorageDevice} from '../../hooks/use-storage'
import {canDisconnectPoolMember, formatStorageSize, hasPoolMutationInProgress} from '../../utils'
import {StorageNotice} from '../storage-page'
import {OperationInProgressBanner} from './operation-in-progress-banner'
import {ProInstallInstructions} from './pro-install-instructions'
import {ShutdownConfirmationDialog} from './shutdown-confirmation-dialog'

type SwapDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	raidType?: 'storage' | 'failsafe'
	/** Umbrel Pro slot of the device being swapped */
	slot?: number | null
	/** Device id of the device being swapped - used on devices without physical slots */
	oldDeviceId?: string | null
	/** Whether the device being swapped has failed (pool degraded) - adjusts title and banner */
	oldDeviceFailed?: boolean
	/** Wording hint for a swapped member whose physical device is missing (no type to read) */
	missingDeviceType?: 'ssd' | 'hdd'
	isUmbrelPro: boolean
	raidStatus: RaidStatus | undefined
	availableDevices: StorageDevice[]
	allDevices: StorageDevice[]
	replaceDeviceAsync: (params: {oldDevice: string; newDevice: string}) => Promise<boolean>
}

export function SwapDialog({
	open,
	onOpenChange,
	raidType,
	slot = null,
	oldDeviceId = null,
	oldDeviceFailed = false,
	missingDeviceType,
	isUmbrelPro,
	raidStatus,
	availableDevices,
	allDevices,
	replaceDeviceAsync,
}: SwapDialogProps) {
	const {t} = useTranslation()
	const {setPendingOperation, clearPendingOperation, setOperationError} = usePendingRaidOperation()

	// Check if a RAID operation is already in progress
	const activeOperation = useActiveRaidOperation()

	const [selectedReplacementId, setSelectedReplacementId] = useState<string | null>(null)
	const [showShutdownConfirmation, setShowShutdownConfirmation] = useState(false)

	const deviceName = isUmbrelPro ? t('storage-manager.umbrel-pro') : t('storage-manager.device')
	const isStorageMode = raidType === 'storage'
	const maxSlots = 4
	// Count occupied physical slots, including drives outside the pool. Generic
	// hardware (or an unresolved Pro slot) has unknown expansion capability.
	const slotsKnown =
		isUmbrelPro &&
		allDevices
			.filter((device) => device.type === 'ssd')
			.every((device) => device.slot && device.slot >= 1 && device.slot <= maxSlots)
	const hasFreeSlot = slotsKnown
		? new Set(allDevices.map((device) => device.slot).filter(Boolean)).size < maxSlots
		: undefined

	// Get the device being replaced (needed for size validation)
	const oldDevice = slot
		? allDevices.find((d) => d.slot === slot)
		: oldDeviceId
			? allDevices.find((d) => d.id === oldDeviceId)
			: null

	// Copy variants: dialogs opened via slot describe SSDs (Umbrel Pro), otherwise word
	// choice follows the swapped device's type (HDD pools say drive, accelerator SSDs and
	// SSD pools keep SSD wording).
	// dv('storage-manager.swap.foo') resolves to 'storage-manager.swap.foo-drive' when generic.
	const isGenericDrive = !slot && (oldDevice ? oldDevice.type !== 'ssd' : missingDeviceType !== 'ssd')
	const dv = (key: string) => t(isGenericDrive ? `${key}-drive` : key)
	// Whole titles rather than a verb and a label, since languages order them differently ("SSD 2 tauschen")
	const swapTitle = slot
		? t('storage-manager.swap.title-slot', {slot})
		: isGenericDrive
			? t('storage-manager.swap.title-drive')
			: t('storage-manager.swap.title')
	const replaceTitle = slot
		? t('storage-manager.replace-failed.title-slot', {slot})
		: isGenericDrive
			? t('storage-manager.replace-failed.title-drive')
			: t('storage-manager.replace-failed.title')
	// "SSD" slot labels are not translated - they match the physical device markings
	const swappedLabelDefinite = slot
		? `SSD ${slot}`
		: isGenericDrive
			? t('storage-manager.swap.the-old-drive')
			: t('storage-manager.swap.the-old-ssd')

	// The API does not establish hot-swap capability. Always power off before
	// physically changing a drive; SATA transport alone is not sufficient.

	// Filter available devices to only show those large enough for replacement.
	// ZFS requires replacement devices to be at least as large as the device being replaced.
	// We compare roundedSize (not raw size) because the backend partitions devices using roundedSize,
	// so ZFS validates based on partition sizes which are determined by roundedSize.
	const validReplacementDevices = oldDevice
		? availableDevices.filter((d) => (d.roundedSize ?? d.size) >= (oldDevice.roundedSize ?? oldDevice.size))
		: availableDevices

	const hasAvailableDevices = availableDevices.length > 0

	// Initialize selection when dialog opens, reset when it closes
	// Note: validReplacementDevices intentionally omitted from deps - it's a new array ref each render,
	// and we only want to auto-select once when the dialog opens, not reset on every render
	useEffect(() => {
		if (open) {
			setSelectedReplacementId(validReplacementDevices.length === 1 ? (validReplacementDevices[0].id ?? null) : null)
		} else {
			setShowShutdownConfirmation(false)
			setSelectedReplacementId(null)
		}
	}, [open])

	const targetId = oldDevice?.id ?? oldDeviceId ?? undefined
	// Inserting a replacement for a known missing member removes no remaining data.
	// Keep the removal checks for connected members, which may still be contributing.
	const isMissingMember =
		!oldDevice &&
		!!targetId &&
		[...(raidStatus?.devices ?? []), ...(raidStatus?.accelerator?.devices ?? [])].some(
			(member) => member.id === targetId,
		)
	// Repair takes priority over a scrub, just as in ReplaceFailedDriveDialog.
	const isOperationInProgress =
		hasPoolMutationInProgress(raidStatus) ||
		(!!activeOperation && !(isMissingMember && raidType === 'failsafe' && activeOperation.type === 'scrub'))
	const removalBlocked =
		raidType === 'failsafe' && !isMissingMember && !canDisconnectPoolMember(raidStatus, targetId, allDevices)
	const storageUnavailable = !raidStatus?.exists || !['ONLINE', 'DEGRADED'].includes(raidStatus.status ?? '')
	if (removalBlocked || storageUnavailable || isOperationInProgress) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							<DialogTitle>
								{t(
									isMissingMember
										? 'storage-manager.swap.replacement-unavailable'
										: 'storage-manager.swap.leave-connected',
								)}
							</DialogTitle>
							<DialogDescription>
								{t(isMissingMember ? 'storage-manager.swap.replacement-wait' : 'storage-manager.swap.removal-blocked')}
							</DialogDescription>
						</DialogHeader>
						{!isMissingMember && <StorageNotice>{t('storage-manager.swap.removal-risk')}</StorageNotice>}
						{isOperationInProgress && <OperationInProgressBanner variant='wait' />}
						<DialogFooter>
							<Button size='dialog' onClick={() => onOpenChange(false)}>
								{t('done')}
							</Button>
						</DialogFooter>
					</div>
				</DialogScrollableContent>
			</Dialog>
		)
	}

	// An attached replacement establishes a usable connection, without guessing spare slots.
	// Requires an attached old device: without it there is no size validation and the
	// confirm could never enable, so missing members fall through to the instructions.
	if (isStorageMode && hasAvailableDevices && oldDevice) {
		const selectedDevice = validReplacementDevices.find((d) => d.id === selectedReplacementId)
		// Same verb as the button that opened this: Swap for a healthy drive, Replace for a failed one
		const actionLabel = oldDeviceFailed ? t('storage-manager.replace') : t('storage-manager.swap')

		const handleReplace = () => {
			if (!selectedDevice?.id || !oldDevice?.id) return

			// Replace is non-blocking - we show island immediately
			setPendingOperation({
				type: 'replace',
				state: 'starting',
				progress: 0,
			})
			onOpenChange(false)

			replaceDeviceAsync({
				oldDevice: oldDevice.id,
				newDevice: selectedDevice.id,
			}).catch((error) => {
				clearPendingOperation()
				setOperationError(error instanceof Error ? error.message : t('unknown-error'))
				toast.error(t('storage-manager.swap.failed-to-start'), {area: 'settings'})
			})
		}

		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent onOpenAutoFocus={(e) => e.preventDefault()}>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							<DialogTitle>{oldDeviceFailed ? replaceTitle : swapTitle}</DialogTitle>
							<DialogDescription>{dv('storage-manager.swap.description-replace')}</DialogDescription>
						</DialogHeader>

						{oldDeviceFailed ? (
							/* Full Storage has no redundancy - a failed member means data is already at
							   risk, so don't promise a lossless copy */
							<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
								<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-destructive2'>
										{isGenericDrive
											? t('storage-manager.replace-failed.degraded-storage-drive')
											: t('storage-manager.replace-failed.degraded-storage')}
									</span>
									<span className='text-12 text-white/60'>{dv('storage-manager.swap.failed-description-storage')}</span>
								</div>
							</div>
						) : (
							/* Info banner */
							<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
								<TbInfoCircle className='mt-0.5 size-5 shrink-0 text-brand' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-brand'>{t('storage-manager.swap.no-data-loss')}</span>
									<span className='text-12 text-white/60'>{dv('storage-manager.swap.no-data-loss-description')}</span>
								</div>
							</div>
						)}

						{/* Drive selection - show all available, disable those too small */}
						<div className='flex flex-col gap-2'>
							<span className='text-13 font-medium text-white/60'>{dv('storage-manager.swap.select-new-ssd')}</span>
							<div className='flex flex-col gap-2'>
								{availableDevices.map((device) => {
									const isSelected = selectedReplacementId === device.id
									const isTooSmall = oldDevice
										? (device.roundedSize ?? device.size) < (oldDevice.roundedSize ?? oldDevice.size)
										: false
									return (
										<button
											key={device.id}
											type='button'
											onClick={() => !isTooSmall && setSelectedReplacementId(device.id ?? null)}
											disabled={isTooSmall}
											className={cn(
												'flex items-center gap-3 rounded-12 border p-3 text-left transition-colors',
												isTooSmall
													? 'cursor-not-allowed border-white/5 bg-white/[0.02] opacity-60'
													: isSelected
														? 'border-brand bg-brand/10'
														: 'border-white/10 bg-white/5 hover:bg-white/8',
											)}
										>
											<div
												className={cn(
													'flex size-5 items-center justify-center rounded-full border-2',
													isTooSmall ? 'border-white/20' : isSelected ? 'border-brand bg-brand' : 'border-white/30',
												)}
											>
												{isSelected && !isTooSmall && <div className='size-2 rounded-full bg-white' />}
											</div>
											<div className='flex flex-1 flex-col gap-0.5'>
												{/* "SSD" and "Slot" labels are not translated - they match the physical device markings.
												    Devices without physical slots show size and model instead. */}
												<span className={cn('text-13 font-medium', isTooSmall ? 'text-white/50' : 'text-white')}>
													{device.slot
														? t('storage-manager.swap.ssd-in-slot', {
																size: formatStorageSize(device.size),
																slot: device.slot,
															})
														: `${formatStorageSize(device.size)} · ${device.model}`}
												</span>
												{device.name && (
													<span className={cn('text-12', isTooSmall ? 'text-white/30' : 'text-white/40')}>
														{device.name}
													</span>
												)}
												{isTooSmall && (
													<span className='text-12 leading-snug text-[#F5A623]'>
														{t('storage-manager.replace-failed.too-small-description-drive', {
															deviceSize: formatStorageSize(device.size),
															minSize: formatStorageSize(oldDevice.roundedSize ?? oldDevice.size),
														})}
													</span>
												)}
											</div>
										</button>
									)
								})}
							</div>
						</div>

						{/* Erase warning for devices without physical slots (the drive may have been used elsewhere before) */}
						{selectedDevice && !selectedDevice.slot && (
							<p className='text-[13px] text-yellow-500'>
								<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
								{t('storage-manager.add-drive-erase-warning')}
							</p>
						)}

						{/* What happens next */}
						<div className='flex flex-col gap-2'>
							<span className='text-13 font-medium text-white/60'>{t('storage-manager.swap.what-happens-next')}</span>
							<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
								{[
									dv('storage-manager.swap.step-data-copied'),
									t('storage-manager.swap.step-may-take-while'),
									t('storage-manager.swap.step-remove-old', {ssd: swappedLabelDefinite}),
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

						{isOperationInProgress && <OperationInProgressBanner variant='wait' />}

						<DialogFooter>
							<Button
								variant='primary'
								size='dialog'
								onClick={handleReplace}
								disabled={!selectedDevice || !oldDevice || isOperationInProgress}
							>
								{actionLabel}
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

	// No replacement is attached. Explain the connection requirement before physical steps.
	// Umbrel Pro gets the installation photo with prose instead of a step list.
	if (isStorageMode && hasFreeSlot !== false) {
		// The re-entry step names the button that reopens this dialog, which reads Replace
		// for a failed member and Swap otherwise (matching the title above)
		const returnStep = oldDeviceFailed
			? t('storage-manager.swap.step-return-to-replace')
			: t('storage-manager.swap.step-return-to-swap')
		// Power down before adding a drive; the hardware capability is unknown.
		const steps = [
			t('storage-manager.swap.step-shut-down', {deviceName}),
			dv('storage-manager.swap.step-insert-new-ssd'),
			t('storage-manager.swap.step-power-on', {deviceName}),
			returnStep,
		]

		return (
			<>
				<Dialog open={open} onOpenChange={onOpenChange}>
					<DialogScrollableContent onOpenAutoFocus={(e) => e.preventDefault()}>
						<div className='flex flex-col gap-5 p-5'>
							<DialogHeader>
								<DialogTitle>{oldDeviceFailed ? replaceTitle : swapTitle}</DialogTitle>
								<DialogDescription>{t('storage-manager.swap.description-full-storage')}</DialogDescription>
							</DialogHeader>

							{oldDeviceFailed ? (
								/* The member has failed (or is missing entirely) - no safe-swap promises */
								<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
									<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
									<div className='flex flex-col gap-1'>
										<span className='text-13 font-semibold text-destructive2'>
											{isGenericDrive
												? t('storage-manager.replace-failed.degraded-storage-drive')
												: t('storage-manager.replace-failed.degraded-storage')}
										</span>
										<span className='text-12 text-white/60'>
											{dv('storage-manager.swap.failed-description-storage')}
										</span>
									</div>
								</div>
							) : (
								/* Info banner */
								<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
									<TbInfoCircle className='mt-0.5 size-5 shrink-0 text-brand' />
									<div className='flex flex-col gap-1'>
										<span className='text-13 font-semibold text-brand'>
											{t('storage-manager.swap.safe-swap-available')}
										</span>
										<span className='text-12 text-white/60'>
											{hasFreeSlot === undefined
												? t('storage-manager.swap.connection-needed')
												: dv('storage-manager.swap.safe-swap-description')}
										</span>
									</div>
								</div>
							)}

							{isUmbrelPro ? (
								<ProInstallInstructions
									paragraphs={[
										t('storage-manager.swap.pro-instructions-insert-1'),
										t('storage-manager.swap.pro-instructions-insert-2'),
									]}
								/>
							) : (
								<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
									{steps.map((step, index) => (
										<div key={index} className='flex items-center gap-3 p-3 text-12 font-medium -tracking-3'>
											<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
												{index + 1}
											</span>
											<span>{step}</span>
										</div>
									))}
								</div>
							)}

							{isOperationInProgress && <OperationInProgressBanner variant='shutdown-safe' />}

							<DialogFooter>
								<Button variant='primary' size='dialog' onClick={() => setShowShutdownConfirmation(true)}>
									{t('shut-down')}
								</Button>
								<Button variant='default' size='dialog' onClick={() => onOpenChange(false)}>
									{t('cancel')}
								</Button>
							</DialogFooter>
						</div>
					</DialogScrollableContent>
				</Dialog>

				<ShutdownConfirmationDialog open={showShutdownConfirmation} onOpenChange={setShowShutdownConfirmation} />
			</>
		)
	}

	if (isStorageMode) {
		// No free slot because all 4 slots are in use - you would need to use backup, factory reset, and restore workflow
		// "SSD" slot labels are not translated - they match the physical device markings
		const ssdLabel = slot ? `SSD ${slot}` : t('storage-manager.swap.the-old-ssd')
		const steps = [
			{
				title: t('storage-manager.swap.step-backup'),
				description: t('storage-manager.swap.step-backup-description'),
			},
			{
				title: t('storage-manager.swap.step-factory-reset'),
				description: t('storage-manager.swap.step-factory-reset-description', {deviceName}),
			},
			{
				title: t('storage-manager.swap.step-shut-down-and-swap', {ssd: ssdLabel}),
				description: isUmbrelPro
					? t('storage-manager.swap.step-shut-down-and-swap-description-pro')
					: t('storage-manager.swap.step-shut-down-and-swap-description-other'),
			},
			{
				title: t('storage-manager.swap.step-setup-new-storage'),
				description: t('storage-manager.swap.step-setup-new-storage-description', {deviceName}),
			},
			{
				title: t('storage-manager.swap.step-restore'),
				description: t('storage-manager.swap.step-restore-description'),
			},
		]

		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
					<DialogHeader>
						{/* SSD wording even without a slot, like the steps below */}
						<DialogTitle>
							{slot ? t('storage-manager.swap.title-slot', {slot}) : t('storage-manager.swap.title')}
						</DialogTitle>
						<DialogDescription>{t('storage-manager.swap.description-no-free-slot')}</DialogDescription>
					</DialogHeader>

					{/* Warning banner */}
					<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
						<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
						<div className='flex flex-col gap-1'>
							<span className='text-13 font-semibold text-destructive2'>
								{t('storage-manager.swap.data-will-be-erased')}
							</span>
							<span className='text-12 text-white/60'>
								{t('storage-manager.swap.data-erased-description', {deviceName})}
							</span>
						</div>
					</div>

					{/* Steps */}
					<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						{steps.map((step, index) => (
							<div key={index} className='flex items-start gap-3 p-3'>
								<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
									{index + 1}
								</span>
								<div className='flex flex-col gap-0.5'>
									<span className='text-12 font-semibold text-white'>{step.title}</span>
									<span className='text-12 text-white/50'>{step.description}</span>
								</div>
							</div>
						))}
					</div>

					<DialogFooter>
						<Button variant='default' size='dialog' onClick={() => onOpenChange(false)}>
							{t('done')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		)
	}

	// Connected FailSafe members passed the removal checks; missing ones only need insertion.
	const steps = [
		t('storage-manager.swap.step-shut-down', {deviceName}),
		isMissingMember
			? dv('storage-manager.swap.step-insert-new-ssd')
			: t('storage-manager.swap.step-swap-ssd', {ssd: swappedLabelDefinite}),
		t('storage-manager.swap.step-power-on', {deviceName}),
		dv('storage-manager.swap.step-return-to-storage-manager'),
	]
	// A larger replacement only adds space once the drives sharing its data are larger too:
	// the other drive of an HDD pair, or every SSD in the pool, since FailSafe uses the
	// smallest SSD's size on all of them. Accelerator SSDs add no storage space.
	const isDataMember = raidStatus?.devices?.some((member) => member.id === targetId)
	const largerDriveNote =
		isMissingMember || !isDataMember
			? null
			: raidStatus?.topology === 'mirror'
				? t('storage-manager.swap.larger-drives-pair')
				: raidStatus?.topology === 'raidz'
					? t('storage-manager.swap.larger-ssds')
					: null

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							<DialogTitle>{oldDeviceFailed || isMissingMember ? replaceTitle : swapTitle}</DialogTitle>
							<DialogDescription>{t('storage-manager.swap.description-failsafe')}</DialogDescription>
						</DialogHeader>

						{oldDeviceFailed || isMissingMember ? (
							/* The drive has failed - be honest that protection is reduced until it's swapped */
							<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
								<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-destructive2'>
										{t('storage-manager.replace-failed.degraded')}
									</span>
									<span className='text-12 text-white/60'>
										{isMissingMember
											? t('storage-manager.swap.missing-description')
											: dv('storage-manager.swap.failed-description')}
									</span>
								</div>
							</div>
						) : (
							/* State was checked above; still avoid guarantees about data recovery. */
							<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
								<IoShieldHalf className='mt-0.5 size-5 shrink-0 text-brand' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-brand'>{t('storage-manager.swap.data-protected')}</span>
									<span className='text-12 text-white/60'>{dv('storage-manager.swap.data-protected-description')}</span>
								</div>
							</div>
						)}

						{isUmbrelPro ? (
							<ProInstallInstructions
								paragraphs={[
									isMissingMember
										? t('storage-manager.swap.pro-instructions-insert-1')
										: t('storage-manager.swap.pro-instructions-swap-1', {ssd: swappedLabelDefinite}),
									t('storage-manager.swap.pro-instructions-swap-2'),
								]}
							/>
						) : (
							<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
								{steps.map((step, index) => (
									<div key={index} className='flex items-center gap-3 p-3 text-12 font-medium -tracking-3'>
										<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
											{index + 1}
										</span>
										<span>{step}</span>
									</div>
								))}
							</div>
						)}

						{largerDriveNote && <p className='text-13 leading-relaxed text-white/50'>{largerDriveNote}</p>}

						{isOperationInProgress && <OperationInProgressBanner variant='shutdown-safe' />}

						<DialogFooter>
							<Button variant='primary' size='dialog' onClick={() => setShowShutdownConfirmation(true)}>
								{t('shut-down')}
							</Button>
							<Button variant='default' size='dialog' onClick={() => onOpenChange(false)}>
								{t('cancel')}
							</Button>
						</DialogFooter>
					</div>
				</DialogScrollableContent>
			</Dialog>

			<ShutdownConfirmationDialog open={showShutdownConfirmation} onOpenChange={setShowShutdownConfirmation} />
		</>
	)
}
