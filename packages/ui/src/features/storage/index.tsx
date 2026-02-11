import {DialogPortal} from '@radix-ui/react-dialog'
import {useState} from 'react'
import {
	TbActivityHeartbeat,
	TbAlertTriangle,
	TbAlertTriangleFilled,
	TbCircleCheckFilled,
	TbPlus,
	TbRefreshDot,
} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {Spinner} from '@/components/ui/loading'
import {useIsUmbrelPro} from '@/hooks/use-is-umbrel-pro'
import {useTemperatureUnit} from '@/hooks/use-temperature-unit'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

import {AddToRaidDialog} from './components/dialogs/add-to-raid-dialog'
import {InstallSsdDialog} from './components/dialogs/install-ssd-dialog'
import {ReplaceFailedDriveDialog} from './components/dialogs/replace-failed-drive-dialog'
import {SsdHealthDialog, useSsdHealthDialog} from './components/dialogs/ssd-health-dialog'
import {SwapDialog} from './components/dialogs/swap-dialog'
import {SsdShape} from './components/ssd-shape'
import {StorageDonutChart} from './components/storage-donut-chart'
import {StorageModeDisplay} from './components/storage-mode-display'
import {StorageDevice, useStorage} from './hooks/use-storage'
import {formatStorageSize} from './utils'

// Simple divider for storage info section
const StorageDivider = () => <div className='h-px w-2/3 bg-linear-to-r from-transparent via-white/15 to-transparent' />

// Storage stats display - shared between mobile and desktop layouts
function StorageStats({
	isLoading,
	totalCapacityBytes,
	availableBytes,
	failsafeOverheadBytes,
	wastedBytes,
}: {
	isLoading: boolean
	totalCapacityBytes: number
	availableBytes: number
	failsafeOverheadBytes: number
	wastedBytes: number
}) {
	return (
		<div className='flex w-full flex-col items-center'>
			{/* Total capacity */}
			<div className='py-2.5 text-center'>
				<div className={cn('text-[16px] font-semibold text-white', isLoading && 'animate-pulse text-white/30')}>
					{isLoading ? '—' : formatStorageSize(totalCapacityBytes)}
				</div>
				<div className='text-[13px] font-semibold text-white/50'>{t('storage-manager.total-capacity-added')}</div>
			</div>

			<StorageDivider />

			{/* Available storage */}
			<div className='py-2.5 text-center'>
				<div className={cn('text-[16px] font-semibold text-white', isLoading && 'animate-pulse text-white/30')}>
					{isLoading ? '—' : formatStorageSize(availableBytes)}
				</div>
				<div className='flex items-center justify-center gap-1.5'>
					<span className='size-2 rounded-full bg-brand' />
					<span className='text-[13px] font-semibold text-white/50'>{t('storage-manager.available-storage')}</span>
				</div>
			</div>

			{/* FailSafe - hide entirely when loading */}
			{!isLoading && failsafeOverheadBytes > 0 && (
				<>
					<StorageDivider />
					<div className='py-2.5 text-center'>
						<div className='text-[16px] font-semibold text-white'>{formatStorageSize(failsafeOverheadBytes)}</div>
						<div className='flex items-center justify-center gap-1.5'>
							<span
								className='size-2 rounded-full'
								style={{backgroundColor: 'color-mix(in srgb, hsl(var(--color-brand)), white 60%)'}}
							/>
							<span className='text-[13px] font-semibold text-white/50'>{t('storage-manager.for-failsafe')}</span>
						</div>
					</div>
				</>
			)}

			{/* Wasted - hide entirely when loading */}
			{!isLoading && wastedBytes > 0 && (
				<>
					<StorageDivider />
					<div className='py-2.5 text-center'>
						<div className='text-[16px] font-semibold text-white'>{formatStorageSize(wastedBytes)}</div>
						<div className='flex items-center justify-center gap-1.5'>
							<TbAlertTriangleFilled className='size-3.5 text-[#F5A623]' />
							<span className='text-[13px] font-semibold text-white/50'>{t('storage-manager.wasted')}</span>
						</div>
					</div>
				</>
			)}
		</div>
	)
}

// Umbrel Pro has 4 SSD slots
const SLOT_INDICES = [0, 1, 2, 3] as const

export default function StorageManagerDialog() {
	const navigate = useNavigate()
	const [temperatureUnit] = useTemperatureUnit()

	const {isUmbrelPro} = useIsUmbrelPro()

	// Get actual storage data
	// We poll every 15 seconds to keep temperature and health status up to date
	const {
		allDevices,
		raidDevices,
		availableDevices,
		ssdSlots,
		readyToAddIds,
		chartData,
		usedSpace,
		availableBytes,
		failsafeOverheadBytes,
		wastedBytes,
		totalCapacityBytes,
		raidType,
		raidDriveCount,
		minRoundedDriveSize,
		canChooseMode,
		raidStatus,
		isLoading: isStorageLoading,
		// Degraded replacement
		failedRaidDevices,
		canReplaceFailedDevice,
		// Mutations
		addDeviceAsync,
		transitionToFailsafeAsync,
		replaceDeviceAsync,
	} = useStorage({pollInterval: 15_000})

	// Check if any RAID device doesn't have a matching physical device
	// This means there's a drive the RAID knows about but we can't display accurately in the UI
	const hasMissingDrive = raidStatus?.devices?.some((rd: {id: string}) => !allDevices.find((d) => d.id === rd.id))
	const showMissingDriveWarning = hasMissingDrive

	// Health dialog state
	const healthDialog = useSsdHealthDialog()
	// Look up device from live data so polling keeps health dialog fresh (device health + RAID status)
	const healthDialogDevice = allDevices?.find((d) => d.id === healthDialog.selectedDevice?.deviceId)

	// Dialog states
	const [isInstallSsdDialogOpen, setIsInstallSsdDialogOpen] = useState(false)
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
	const [deviceToAdd, setDeviceToAdd] = useState<StorageDevice | null>(null)
	const [isSwapDialogOpen, setIsSwapDialogOpen] = useState(false)
	const [swapSlot, setSwapSlot] = useState<number | null>(null)
	const [isReplaceFailedDialogOpen, setIsReplaceFailedDialogOpen] = useState(false)
	const [deviceForReplacement, setDeviceForReplacement] = useState<StorageDevice | null>(null)

	// Pre-compute slot states to avoid logic duplication between mobile and desktop
	const slotStates = SLOT_INDICES.map((i) => {
		const device = ssdSlots[i]
		const isReadyToAdd = device && readyToAddIds.has(device.id)
		const isInRaid = device && !isReadyToAdd
		const raidDevice = device ? raidDevices.find((rd) => rd.id === device.id) : undefined
		const isFailedDrive = raidDevice && raidDevice.raidStatus !== 'ONLINE'
		const hasWarning = device && (isFailedDrive || device.smartStatus === 'unhealthy')
		return {device, isReadyToAdd, isInRaid, raidDevice, isFailedDrive, hasWarning}
	})

	return (
		<ImmersiveDialog
			open={true}
			onOpenChange={(isOpen) => {
				if (!isOpen) {
					navigate('/settings', {preventScrollReset: true})
				}
			}}
		>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent
					size='md'
					showScroll
					style={{
						backgroundColor: 'rgba(8, 8, 8, 0.5)',
						backdropFilter: 'blur(80px)',
						boxShadow: '0px 32px 32px 0px #00000052, inset 1px 1px 1px 0px #FFFFFF14',
					}}
				>
					<div className='flex h-full flex-col gap-6'>
						<h1 className={immersiveDialogTitleClass}>{t('storage-manager')}</h1>

						{/* Mode display */}
						<div className='flex flex-col gap-2.5'>
							<span className='text-13 font-semibold text-white/50'>{t('storage-manager.mode')}</span>
							<StorageModeDisplay value={raidType ?? 'storage'} canEnableFailsafe={canChooseMode ?? false} />
						</div>

						{/* Warning banner for missing/unavailable drive */}
						{showMissingDriveWarning && (
							<div className='flex items-center gap-2 rounded-8 bg-[#3C1C1C] p-2.5 text-13 leading-tight -tracking-2 text-[#FF3434]'>
								<TbAlertTriangle className='h-5 w-5 shrink-0' />
								<span className='opacity-90'>{t('storage-manager.missing-ssd-warning')}</span>
							</div>
						)}

						{/* Mobile: SSD List Card */}
						<div className='flex flex-col gap-6 md:hidden'>
							<div className='flex flex-col rounded-xl bg-white/5 p-3'>
								{slotStates.map(({device, isReadyToAdd, isInRaid, isFailedDrive, hasWarning}, i) => (
									<div
										key={`mobile-slot-${i}`}
										className='flex items-center justify-between gap-2 rounded-lg px-2 py-2'
									>
										{/* Left: Status + Slot info */}
										<div className='flex items-center gap-2'>
											{/* Only show checkmark when device is in RAID, warning if issues, empty otherwise */}
											{isInRaid ? (
												hasWarning ? (
													<TbAlertTriangle className='size-5 shrink-0 text-[#F5A623]' />
												) : (
													<TbCircleCheckFilled className='size-5 shrink-0 text-brand' />
												)
											) : (
												<div className='size-5 shrink-0' />
											)}
											{/* "SSD" labels are not translated - they match the physical device markings */}
											<span className='text-[14px] font-medium text-white/60'>
												SSD {i + 1}
												{device && (
													<>
														{' · '}
														<span className='text-white'>{formatStorageSize(device.size)}</span>
													</>
												)}
												{!device && <span className='text-white/40'> · {t('storage-manager.empty')}</span>}
											</span>
										</div>

										{/* Right: Health pill + Action button */}
										<div className='flex items-center gap-2'>
											{/* Health pill - only when device present */}
											{device && (
												<button
													type='button'
													onClick={() => healthDialog.openDialog(device, i + 1)}
													className='relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] px-3 py-0.5'
												>
													<TbActivityHeartbeat className='size-4 text-white/60' />
													{hasWarning && (
														<span className='absolute -top-0.5 right-1.5'>
															<span className='absolute inset-0 size-2.5 rounded-full bg-[#F5A623]' />
															<span className='absolute inset-0 size-2.5 animate-ping rounded-full bg-[#F5A623] opacity-75' />
														</span>
													)}
												</button>
											)}

											{/* Action button - fixed width container for alignment */}
											<div className='w-[76px]'>
												{isInRaid ? (
													<button
														type='button'
														onClick={() => {
															setSwapSlot(i + 1)
															setIsSwapDialogOpen(true)
														}}
														className={cn(
															'flex w-full items-center justify-center gap-1 rounded-full py-1 text-[12px] font-medium transition-colors',
															isFailedDrive
																? 'bg-[#FF3434] text-white hover:bg-[#FF3434]/90'
																: 'border border-white/[0.08] bg-white/[0.06] text-white/80 hover:bg-white/10',
														)}
													>
														<TbRefreshDot className='size-3.5' />
														{isFailedDrive ? t('storage-manager.replace') : t('storage-manager.swap')}
													</button>
												) : isReadyToAdd ? (
													canReplaceFailedDevice ? (
														// Degraded array - offer to replace failed device
														<button
															type='button'
															onClick={() => {
																setDeviceForReplacement(device)
																setIsReplaceFailedDialogOpen(true)
															}}
															className='flex w-full items-center justify-center gap-1 rounded-full bg-[#FF3434] py-1 text-[12px] font-medium text-white transition-colors hover:bg-[#FF3434]/90'
														>
															<TbRefreshDot className='size-3.5' />
															{t('storage-manager.replace')}
														</button>
													) : (
														// Normal add flow
														<button
															type='button'
															onClick={() => {
																setDeviceToAdd(device)
																setIsAddDialogOpen(true)
															}}
															className='flex w-full animate-pulse items-center justify-center gap-1 rounded-full border border-white/20 bg-white/15 py-1 text-[12px] font-medium text-white transition-colors hover:bg-white/20'
														>
															<TbPlus className='size-3' strokeWidth={3} />
															{t('storage-manager.add')}
														</button>
													)
												) : (
													<button
														type='button'
														onClick={() => setIsInstallSsdDialogOpen(true)}
														className='flex w-full items-center justify-center gap-1 rounded-full bg-brand py-1 text-[12px] font-medium text-white transition-colors hover:bg-brand/90'
													>
														<TbPlus className='size-3' strokeWidth={3} />
														{t('storage-manager.add')}
													</button>
												)}
											</div>
										</div>
									</div>
								))}
							</div>

							{/* Storage info for mobile */}
							<div className='flex flex-col items-center gap-4'>
								<StorageDonutChart
									used={chartData.used}
									available={chartData.available}
									failsafe={chartData.failsafe}
									wasted={chartData.wasted}
									usedBytes={usedSpace}
									isLoading={isStorageLoading}
								/>
								<StorageStats
									isLoading={isStorageLoading}
									totalCapacityBytes={totalCapacityBytes}
									availableBytes={availableBytes}
									failsafeOverheadBytes={failsafeOverheadBytes}
									wastedBytes={wastedBytes}
								/>
							</div>
						</div>

						{/* Desktop: Device visualization and info */}
						<div className='hidden flex-1 items-start gap-6 px-6 md:flex'>
							{/* Left: Device visualization */}
							<div className='flex flex-col items-center gap-3'>
								{/* Gradient border using pseudo-element technique */}
								<div
									className='relative h-[480px] w-[480px] rounded-[69px] border-[3px] border-transparent bg-[radial-gradient(78%_100%_at_50%_0%,_rgba(255,255,255,0.12)_0%,_rgba(255,255,255,0.04)_100%)] bg-clip-padding'
									style={{containerType: 'inline-size'}}
								>
									{/* Gradient border overlay */}
									<div
										className='pointer-events-none absolute -inset-[3px] rounded-[69px] p-[3px]'
										style={{
											background:
												'linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.05) 100%)',
											WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
											WebkitMaskComposite: 'xor',
											maskComposite: 'exclude',
										}}
									/>

									{/* Loading overlay */}
									{isStorageLoading && (
										<div className='absolute inset-0 z-10 flex items-center justify-center rounded-[66px] bg-black/30'>
											<Spinner size='8' />
										</div>
									)}

									{/* Slot labels - "SSD" is not translated as it matches the physical device markings */}
									{SLOT_INDICES.map((i) => {
										const hasDevice = !!ssdSlots[i]
										return (
											<div
												key={`label-${i}`}
												className={cn('absolute text-center font-medium', hasDevice ? 'text-white' : 'text-white/20')}
												style={{
													left: `${12 + i * 20}%`,
													top: '8%',
													width: '15%',
													fontSize: 'clamp(8px, 2.5cqi, 12px)',
												}}
											>
												SSD {i + 1}
											</div>
										)
									})}

									{/* SSD slots - either SSD shape if present or a dot grid if empty */}
									{SLOT_INDICES.map((i) => {
										const device = ssdSlots[i]
										return (
											<div
												key={`slot-${i}`}
												className='absolute flex items-center justify-center'
												style={{
													left: `${12 + i * 20}%`,
													top: '51%',
													transform: 'translateY(-50%)',
													width: '15%',
												}}
											>
												{/* Dot grid - only show when no SSD present */}
												{!device && (
													<div className='grid grid-cols-5' style={{gap: 'clamp(4px, 1.5cqi, 8px)'}}>
														{Array.from({length: 100}).map((_, dotIndex) => (
															<div
																key={dotIndex}
																className='rounded-full bg-black/[0.56]'
																style={{
																	width: 'clamp(4px, 2cqi, 8px)',
																	height: 'clamp(4px, 2cqi, 8px)',
																}}
															/>
														))}
													</div>
												)}
												{/* SSD shape - only show when SSD present */}
												{device && (
													<SsdShape
														device={device}
														slotNumber={i + 1}
														onHealthClick={() => healthDialog.openDialog(device, i + 1)}
														minRoundedDriveSize={minRoundedDriveSize}
														raidType={raidType}
														temperatureUnit={temperatureUnit}
														isReadyToAdd={readyToAddIds.has(device.id)}
														raidDevice={raidDevices.find((rd) => rd.id === device.id)}
													/>
												)}
											</div>
										)
									})}

									{/* Action buttons below each slot */}
									{slotStates.map(({device, isReadyToAdd, isInRaid, isFailedDrive}, i) => (
										<div
											key={`button-${i}`}
											className='absolute flex justify-center'
											style={{
												left: `${12 + i * 20}%`,
												bottom: '4%',
												width: '15%',
											}}
										>
											{isInRaid ? (
												<button
													type='button'
													onClick={() => {
														setSwapSlot(i + 1)
														setIsSwapDialogOpen(true)
													}}
													className={
														isFailedDrive
															? 'flex items-center gap-0.5 rounded-full bg-[#FF3434] px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#FF3434]/90'
															: 'flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/10'
													}
												>
													<TbRefreshDot className='size-3.5' />
													{isFailedDrive ? t('storage-manager.replace') : t('storage-manager.swap')}
												</button>
											) : isReadyToAdd ? (
												canReplaceFailedDevice ? (
													// Degraded array - offer to replace failed device
													<button
														type='button'
														onClick={() => {
															setDeviceForReplacement(device)
															setIsReplaceFailedDialogOpen(true)
														}}
														className='flex items-center gap-0.5 rounded-full bg-[#FF3434] px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#FF3434]/90'
													>
														<TbRefreshDot className='size-3.5' />
														{t('storage-manager.replace')}
													</button>
												) : (
													// Normal add flow
													<button
														type='button'
														onClick={() => {
															setDeviceToAdd(device)
															setIsAddDialogOpen(true)
														}}
														className='flex animate-pulse items-center gap-0.5 rounded-full border border-white/20 bg-white/15 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-white/20'
													>
														<span className='flex size-3 items-center justify-center rounded-full bg-white/30'>
															<TbPlus className='size-2 text-white' strokeWidth={3} />
														</span>
														{t('storage-manager.add')}
													</button>
												)
											) : (
												<button
													type='button'
													onClick={() => setIsInstallSsdDialogOpen(true)}
													className='flex items-center gap-0.5 rounded-full bg-brand px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-brand/90'
												>
													<span className='flex size-3 items-center justify-center rounded-full bg-white'>
														<TbPlus className='size-2 text-brand' strokeWidth={3} />
													</span>
													{t('storage-manager.add')}
												</button>
											)}
										</div>
									))}
								</div>
								<span className='text-13 font-semibold text-white/50'>{t('storage-manager.umbrel-pro')}</span>
							</div>

							{/* Right: Storage info */}
							<div className='relative flex flex-1 flex-col items-center justify-start gap-4 pt-8'>
								<StorageDonutChart
									used={chartData.used}
									available={chartData.available}
									failsafe={chartData.failsafe}
									wasted={chartData.wasted}
									usedBytes={usedSpace}
									isLoading={isStorageLoading}
								/>
								<StorageStats
									isLoading={isStorageLoading}
									totalCapacityBytes={totalCapacityBytes}
									availableBytes={availableBytes}
									failsafeOverheadBytes={failsafeOverheadBytes}
									wastedBytes={wastedBytes}
								/>
							</div>
						</div>
					</div>
				</ImmersiveDialogContent>
			</DialogPortal>

			{/* SSD Health Dialog - device and RAID status looked up from live data so polling keeps it fresh */}
			{healthDialogDevice && (
				<SsdHealthDialog
					device={healthDialogDevice}
					slotNumber={healthDialog.selectedDevice!.slotNumber}
					open={healthDialog.open}
					onOpenChange={healthDialog.onOpenChange}
					raidDevice={raidDevices.find((rd) => rd.id === healthDialogDevice.id)}
				/>
			)}

			{/* Install SSD Dialog (for empty slots) */}
			<InstallSsdDialog
				open={isInstallSsdDialogOpen}
				onOpenChange={setIsInstallSsdDialogOpen}
				isUmbrelPro={isUmbrelPro}
			/>

			{/* Add to RAID Dialog (for detected but unadded device) */}
			{/* TODO: Currently limited to adding 1 SSD at a time due to ZFS raidz1 limitations.
			    Update UI to support adding multiple SSDs when backend supports it. */}
			<AddToRaidDialog
				open={isAddDialogOpen}
				onOpenChange={(open) => {
					setIsAddDialogOpen(open)
					if (!open) setDeviceToAdd(null)
				}}
				device={deviceToAdd}
				canChooseMode={canChooseMode ?? false}
				raidType={raidType}
				raidDevices={raidDevices}
				addDeviceAsync={addDeviceAsync}
				transitionToFailsafeAsync={transitionToFailsafeAsync}
			/>

			{/* Swap SSD Dialog */}
			<SwapDialog
				open={isSwapDialogOpen}
				onOpenChange={setIsSwapDialogOpen}
				raidType={raidType}
				slot={swapSlot}
				isUmbrelPro={isUmbrelPro}
				raidDriveCount={raidDriveCount}
				availableDevices={availableDevices}
				allDevices={allDevices}
				replaceDeviceAsync={replaceDeviceAsync}
			/>

			{/* Replace Failed Drive Dialog (for degraded arrays) */}
			<ReplaceFailedDriveDialog
				open={isReplaceFailedDialogOpen}
				onOpenChange={(open) => {
					setIsReplaceFailedDialogOpen(open)
					if (!open) setDeviceForReplacement(null)
				}}
				newDevice={deviceForReplacement}
				failedDevice={failedRaidDevices[0] ?? null}
				minRoundedDriveSize={minRoundedDriveSize}
				replaceDeviceAsync={replaceDeviceAsync}
			/>
		</ImmersiveDialog>
	)
}
