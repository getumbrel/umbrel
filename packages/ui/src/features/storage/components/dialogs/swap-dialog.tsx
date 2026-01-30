import {useEffect, useState} from 'react'
import {IoShieldHalf} from 'react-icons/io5'
import {TbAlertTriangle, TbInfoCircle} from 'react-icons/tb'

import {toast} from '@/components/ui/toast'
import {usePendingRaidOperation} from '@/features/storage/contexts/pending-operation-context'
import {useActiveRaidOperation} from '@/features/storage/hooks/use-active-raid-operation'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

import {StorageDevice} from '../../hooks/use-storage'
import {formatStorageSize} from '../../utils'
import {InstallTipsCollapsible} from './install-tips-collapsible'
import {OperationInProgressBanner} from './operation-in-progress-banner'
import {ShutdownConfirmationDialog} from './shutdown-confirmation-dialog'

type SwapDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	raidType?: 'storage' | 'failsafe'
	slot: number | null
	isUmbrelPro: boolean
	raidDriveCount: number
	availableDevices: StorageDevice[]
	allDevices: StorageDevice[]
	replaceDeviceAsync: (params: {oldDevice: string; newDevice: string}) => Promise<boolean>
}

export function SwapDialog({
	open,
	onOpenChange,
	raidType,
	slot,
	isUmbrelPro,
	raidDriveCount,
	availableDevices,
	allDevices,
	replaceDeviceAsync,
}: SwapDialogProps) {
	const {setPendingOperation, clearPendingOperation} = usePendingRaidOperation()

	// Check if a RAID operation is already in progress
	const activeOperation = useActiveRaidOperation()
	const isOperationInProgress = !!activeOperation

	const [showInstallTips, setShowInstallTips] = useState(false)
	const [selectedReplacementId, setSelectedReplacementId] = useState<string | null>(null)
	const [showShutdownConfirmation, setShowShutdownConfirmation] = useState(false)

	const deviceName = isUmbrelPro ? 'Umbrel Pro' : 'device'
	const isStorageMode = raidType === 'storage'
	const maxSlots = isUmbrelPro ? 4 : 4 // TODO: Make configurable for custom devices later
	const hasFreeSlot = raidDriveCount < maxSlots

	// Get the device being replaced (needed for size validation)
	const oldDevice = slot ? allDevices.find((d) => d.slot === slot) : null

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
			setShowInstallTips(false)
			setShowShutdownConfirmation(false)
			setSelectedReplacementId(null)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])

	// Storage mode with free slot AND available devices - we show replacement selection
	if (isStorageMode && hasFreeSlot && hasAvailableDevices) {
		const selectedDevice = validReplacementDevices.find((d) => d.id === selectedReplacementId)

		const handleReplace = () => {
			if (!selectedDevice?.id || !selectedDevice?.slot || !oldDevice?.id) return

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
				toast.error(t('storage-manager.swap.failed-to-start'), {
					description: error instanceof Error ? error.message : t('unknown-error'),
				})
			})
		}

		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent onOpenAutoFocus={(e) => e.preventDefault()}>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							{/* "SSD" slot labels are not translated - they match the physical device markings */}
							<DialogTitle>
								{t('storage-manager.replace')} {slot ? `SSD ${slot}` : 'SSD'}
							</DialogTitle>
							<DialogDescription>{t('storage-manager.swap.description-replace')}</DialogDescription>
						</DialogHeader>

						{/* Info banner */}
						<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
							<TbInfoCircle className='mt-0.5 size-5 shrink-0 text-brand' />
							<div className='flex flex-col gap-1'>
								<span className='text-13 font-semibold text-brand'>{t('storage-manager.swap.no-data-loss')}</span>
								<span className='text-12 text-white/60'>{t('storage-manager.swap.no-data-loss-description')}</span>
							</div>
						</div>

						{/* Drive selection - show all available, disable those too small */}
						<div className='flex flex-col gap-2'>
							<span className='text-13 font-medium text-white/60'>{t('storage-manager.swap.select-new-ssd')}</span>
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
														: 'hover:bg-white/8 border-white/10 bg-white/5',
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
												{/* "SSD" and "Slot" labels are not translated - they match the physical device markings */}
												<span className={cn('text-13 font-medium', isTooSmall ? 'text-white/50' : 'text-white')}>
													{t('storage-manager.swap.ssd-in-slot', {
														size: formatStorageSize(device.size),
														slot: device.slot,
													})}
												</span>
												{device.name && (
													<span className={cn('text-12', isTooSmall ? 'text-white/30' : 'text-white/40')}>
														{device.name}
													</span>
												)}
											</div>
											{isTooSmall && (
												<span className='shrink-0 text-11 font-medium text-[#F5A623]'>
													{t('storage-manager.swap.too-small', {
														size: formatStorageSize(oldDevice?.roundedSize ?? oldDevice?.size ?? 0),
													})}
												</span>
											)}
										</button>
									)
								})}
							</div>
						</div>

						{/* What happens next */}
						<div className='flex flex-col gap-2'>
							<span className='text-13 font-medium text-white/60'>{t('storage-manager.swap.what-happens-next')}</span>
							<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
								{[
									t('storage-manager.swap.step-data-copied'),
									t('storage-manager.swap.step-may-take-while'),
									t('storage-manager.swap.step-remove-old', {ssd: slot ? `SSD ${slot}` : 'the old SSD'}),
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
								onClick={handleReplace}
								disabled={!selectedDevice || !oldDevice || isOperationInProgress}
							>
								{t('storage-manager.replace')}
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

	// Storage mode with free slot but NO available devices - we show "add a drive first" instructions
	if (isStorageMode && hasFreeSlot) {
		const steps = [
			t('storage-manager.swap.step-shut-down', {deviceName}),
			...(isUmbrelPro ? [t('storage-manager.swap.step-remove-bottom-cover')] : []),
			t('storage-manager.swap.step-insert-new-ssd'),
			...(isUmbrelPro ? [t('storage-manager.swap.step-replace-bottom-cover')] : []),
			t('storage-manager.swap.step-power-on', {deviceName}),
			t('storage-manager.swap.step-return-to-swap'),
		]

		return (
			<>
				<Dialog open={open} onOpenChange={onOpenChange}>
					<DialogScrollableContent onOpenAutoFocus={(e) => e.preventDefault()}>
						<div className='flex flex-col gap-5 p-5'>
							<DialogHeader>
								{/* "SSD" slot labels are not translated - they match the physical device markings */}
								<DialogTitle>
									{t('storage-manager.swap')} {slot ? `SSD ${slot}` : 'SSD'}
								</DialogTitle>
								<DialogDescription>{t('storage-manager.swap.description-full-storage')}</DialogDescription>
							</DialogHeader>

							{/* Info banner */}
							<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
								<TbInfoCircle className='mt-0.5 size-5 shrink-0 text-brand' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-brand'>
										{t('storage-manager.swap.safe-swap-available')}
									</span>
									<span className='text-12 text-white/60'>{t('storage-manager.swap.safe-swap-description')}</span>
								</div>
							</div>

							{/* Steps */}
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

							{/* Collapsible installation tips - Umbrel Pro only */}
							{isUmbrelPro && (
								<InstallTipsCollapsible
									isOpen={showInstallTips}
									onToggle={() => setShowInstallTips(!showInstallTips)}
								/>
							)}

							{isOperationInProgress && <OperationInProgressBanner variant='shutdown-safe' />}

							<DialogFooter>
								<Button variant='destructive' onClick={() => setShowShutdownConfirmation(true)}>
									{t('shut-down')}
								</Button>
								<Button variant='default' onClick={() => onOpenChange(false)}>
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
		const ssdLabel = slot ? `SSD ${slot}` : 'the SSD'
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
						{/* "SSD" slot labels are not translated - they match the physical device markings */}
						<DialogTitle>
							{t('storage-manager.swap')} {slot ? `SSD ${slot}` : 'SSD'}
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
						<Button variant='default' onClick={() => onOpenChange(false)}>
							{t('done')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		)
	}

	// FailSafe mode
	const ssdLabel = slot ? `SSD ${slot}` : 'the SSD'
	const steps = [
		t('storage-manager.swap.step-shut-down', {deviceName}),
		...(isUmbrelPro ? [t('storage-manager.swap.step-remove-bottom-cover')] : []),
		t('storage-manager.swap.step-swap-ssd', {ssd: ssdLabel}),
		...(isUmbrelPro ? [t('storage-manager.swap.step-replace-bottom-cover')] : []),
		t('storage-manager.swap.step-power-on', {deviceName}),
		t('storage-manager.swap.step-return-to-storage-manager'),
	]

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							{/* "SSD" slot labels are not translated - they match the physical device markings */}
							<DialogTitle>
								{t('storage-manager.swap')} {slot ? `SSD ${slot}` : 'SSD'}
							</DialogTitle>
							<DialogDescription>{t('storage-manager.swap.description-failsafe')}</DialogDescription>
						</DialogHeader>

						{/* Safe banner */}
						<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
							<IoShieldHalf className='mt-0.5 size-5 shrink-0 text-brand' />
							<div className='flex flex-col gap-1'>
								<span className='text-13 font-semibold text-brand'>{t('storage-manager.swap.data-protected')}</span>
								<span className='text-12 text-white/60'>{t('storage-manager.swap.data-protected-description')}</span>
							</div>
						</div>

						{/* Steps */}
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

						{/* Collapsible installation tips - Umbrel Pro only */}
						{isUmbrelPro && (
							<InstallTipsCollapsible isOpen={showInstallTips} onToggle={() => setShowInstallTips(!showInstallTips)} />
						)}

						{isOperationInProgress && <OperationInProgressBanner variant='shutdown-safe' />}

						<DialogFooter>
							<Button variant='destructive' onClick={() => setShowShutdownConfirmation(true)}>
								{t('shut-down')}
							</Button>
							<Button variant='default' onClick={() => onOpenChange(false)}>
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
