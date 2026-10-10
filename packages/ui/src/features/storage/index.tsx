import {DialogPortal, DialogTitle} from '@radix-ui/react-dialog'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbCircleCheckFilled, TbInfoCircle, TbPlus, TbRefreshDot} from 'react-icons/tb'
import {TiInfoLarge} from 'react-icons/ti'
import {useNavigate} from 'react-router-dom'

import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {Spinner} from '@/components/ui/loading'
import {StorageOperationError} from '@/features/storage/components/storage-operation-error'
import {useIsUmbrelPro} from '@/hooks/use-is-umbrel-pro'
import {useTemperatureUnit} from '@/hooks/use-temperature-unit'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'

import {AddToRaidDialog} from './components/dialogs/add-to-raid-dialog'
import {InstallSsdDialog} from './components/dialogs/install-ssd-dialog'
import {ReplaceFailedDriveDialog} from './components/dialogs/replace-failed-drive-dialog'
import {SsdHealthDialog, useSsdHealthDialog} from './components/dialogs/ssd-health-dialog'
import {SwapDialog} from './components/dialogs/swap-dialog'
import {ListStorageManager} from './components/list-manager'
import {DriveActionButton} from './components/list-manager/drive-card'
import {MdadmSection} from './components/mdadm-section'
import {OtherDrives, StorageMigrationDescription} from './components/other-drives'
import {PoolDataErrorBanner} from './components/pool-data-error-banner'
import SingleDriveStorageManager from './components/single-drive'
import {SsdShape} from './components/ssd-shape'
import {StorageDeviceCard} from './components/storage-device-card'
import {StorageDonutChart} from './components/storage-donut-chart'
import {StorageModeDisplay} from './components/storage-mode-display'
import {StorageNotice} from './components/storage-page'
import {StorageStats} from './components/storage-stats'
import {StorageUnavailable} from './components/storage-unavailable'
import {UsbDrives} from './components/usb-drives'
import {getDeviceHealth, RaidStatus, StorageDevice, useStorage} from './hooks/use-storage'
import {formatStorageSize, getPoolDeviceType, hasRaidErrors} from './utils'

// Umbrel Pro has 4 SSD slots
const SLOT_INDICES = [0, 1, 2, 3] as const

// SSD pools share one manager. Umbrel Pro adds its known four-slot enclosure layout;
// generic SSD hardware renders the same controls against a slotless device rail.
// HDD pools use the list manager built around mirrors and accelerators. Hardware
// without a pool gets the single-drive view of its boot drive - pools are only
// created during onboarding, so there's nothing to manage here beyond drive health.
export default function StorageManagerDialog() {
	const identity = useIsUmbrelPro()
	const {isUmbrelPro, isLoading: isLoadingUmbrelPro} = identity
	const raidStatusQ = trpcReact.hardware.raid.getStatus.useQuery()
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery()

	const loading = isLoadingUmbrelPro || raidStatusQ.isLoading || devicesQ.isLoading
	// A failed refresh must not discard usable data or unmount an open repair flow.
	const error =
		(!identity.hasData ? identity.error : undefined) ??
		(raidStatusQ.data === undefined ? raidStatusQ.error : undefined) ??
		(devicesQ.data === undefined ? devicesQ.error : undefined)
	const configuredPoolUnavailable = !!raidStatusQ.data?.name && !raidStatusQ.data.exists
	const unknownPool =
		raidStatusQ.data?.exists &&
		(!['ONLINE', 'DEGRADED'].includes(raidStatusQ.data.status ?? '') ||
			(!isUmbrelPro && !getPoolDeviceType(raidStatusQ.data, devicesQ.data ?? [])))
	if (loading || error || unknownPool || configuredPoolUnavailable)
		return (
			<StorageUnavailable
				fallbackType={isUmbrelPro ? 'ssd' : undefined}
				loading={loading}
				error={error}
				pool={raidStatusQ.data}
				devices={devicesQ.data}
				retrying={identity.isFetching || raidStatusQ.isFetching || devicesQ.isFetching}
				onRetry={() => {
					void identity.refetch()
					void raidStatusQ.refetch()
					void devicesQ.refetch()
				}}
			/>
		)

	if (isUmbrelPro) return <SsdStorageManager isUmbrelPro />
	if (!raidStatusQ.data?.exists) return <SingleDriveStorageManager devices={devicesQ.data ?? []} />
	if (getPoolDeviceType(raidStatusQ.data, devicesQ.data ?? []) === 'ssd') {
		return <SsdStorageManager isUmbrelPro={false} />
	}
	return <ListStorageManager />
}

function SsdStorageManager({isUmbrelPro}: {isUmbrelPro: boolean}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const [temperatureUnit] = useTemperatureUnit()

	// Get actual storage data
	// We poll every 15 seconds to keep temperature and health status up to date
	const {
		allDevices,
		raidDevices,
		availableSsds,
		availableHdds,
		ssdSlots,
		readyToAddIds,
		chartData,
		usedSpace,
		availableBytes,
		failsafeOverheadBytes,
		wastedBytes,
		totalCapacityBytes,
		raidType,
		minRoundedDriveSize,
		canChooseMode,
		raidStatus,
		isLoading: isStorageLoading,
		// Degraded replacement
		failedRaidDevices,
		isDegraded,
		// Mutations
		addDeviceAsync,
		transitionToFailsafeAsync,
		replaceDeviceAsync,
	} = useStorage({pollInterval: 15_000})

	// Check if any RAID device doesn't have a matching physical device
	// This means there's a drive the RAID knows about but we can't display accurately in the UI
	const hasMissingDrive = raidStatus?.devices?.some((rd: {id: string}) => !allDevices.find((d) => d.id === rd.id))
	// The Pro tray is positional: a pool member whose PCI slot couldn't be resolved would
	// otherwise render nowhere, so surface that anomaly through the warning banner too
	const hasUnmappedProMember =
		isUmbrelPro &&
		raidStatus?.devices?.some((rd: {id: string}) => {
			const device = allDevices.find((d) => d.id === rd.id)
			return device && !(device.slot && device.slot >= 1 && device.slot <= 4)
		})
	const showMissingDriveWarning = hasMissingDrive || hasUnmappedProMember
	// Only an identified SSD pool can offer media-specific migration guidance.
	const hasKnownSsdPool = raidStatus?.topology === 'raidz' || raidDevices.some((device) => device.type === 'ssd')

	// Health dialog state
	const healthDialog = useSsdHealthDialog()
	// Look up device from live data so polling keeps health dialog fresh (device health + RAID status)
	const healthDialogDevice = allDevices?.find((d) => !!d.id && d.id === healthDialog.selectedDevice?.deviceId)

	// Dialog states
	const [isInstallSsdDialogOpen, setIsInstallSsdDialogOpen] = useState(false)
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
	const [deviceToAdd, setDeviceToAdd] = useState<StorageDevice | null>(null)
	const [isSwapDialogOpen, setIsSwapDialogOpen] = useState(false)
	const [swapSlot, setSwapSlot] = useState<number | null>(null)
	const [swapDeviceId, setSwapDeviceId] = useState<string | null>(null)
	const [isReplaceFailedDialogOpen, setIsReplaceFailedDialogOpen] = useState(false)
	const [deviceForReplacement, setDeviceForReplacement] = useState<StorageDevice | null>(null)
	// Which failed member the replace dialog targets - a pool can have several failed drives
	const [failedIdForReplacement, setFailedIdForReplacement] = useState<string | null>(null)

	const detectedGenericSsds = allDevices.filter((device) => device.type === 'ssd' && !device.isSystemDrive && device.id)
	const displayedSsds = isUmbrelPro
		? SLOT_INDICES.map((slotIndex) => ({device: ssdSlots[slotIndex], slotNumber: slotIndex + 1}))
		: detectedGenericSsds.map((device) => ({device, slotNumber: undefined}))
	const canReplaceFailedSsd = isDegraded && failedRaidDevices.length > 0 && availableSsds.length > 0

	// Minimum size a replacement must have: the failed member's own size when its device is
	// still attached (the backend partitions each drive at its own rounded size, so ZFS needs
	// at least that much), otherwise the smallest pool drive as a lower bound
	const replacementSizeFor = (failedId: string | undefined) => {
		const failedDevice = failedId ? allDevices.find((d) => d.id === failedId) : undefined
		return failedDevice?.roundedSize ?? minRoundedDriveSize
	}

	// One clear repair path when the pool is degraded and a new SSD is attached: the failed
	// drive's Replace opens the replace dialog with this candidate pre-selected, while the
	// new SSD itself just advertises that it's ready (no second button). An undersized SSD
	// is never reserved - it keeps its normal Add flow instead.
	const primaryFailed = failedRaidDevices[0]
	const replacementCandidate = canReplaceFailedSsd
		? availableSsds.find((d) => (d.roundedSize ?? d.size) >= replacementSizeFor(primaryFailed?.id))
		: undefined
	const proSlotFor = (device?: StorageDevice) =>
		isUmbrelPro && device?.slot && device.slot >= 1 && device.slot <= 4 ? device.slot : null
	const failedDeviceSlot = proSlotFor(allDevices.find((d) => d.id === primaryFailed?.id))

	// Every member has one repair entry point, whether it appears in the tray or
	// a fallback card. Prefer a fitting spare, then repair an attached failed disk
	// in place (for example, after its labels were lost). Missing disks need insertion.
	const openMemberAction = (member: NonNullable<RaidStatus['devices']>[number], device?: StorageDevice) => {
		const candidate =
			member.status !== 'ONLINE'
				? (availableSsds.find((drive) => (drive.roundedSize ?? drive.size) >= replacementSizeFor(member.id)) ?? device)
				: undefined
		if (candidate) {
			setDeviceForReplacement(candidate)
			setFailedIdForReplacement(member.id)
			setIsReplaceFailedDialogOpen(true)
			return
		}
		const slot = proSlotFor(device)
		setSwapSlot(slot)
		setSwapDeviceId(slot ? null : member.id)
		setIsSwapDialogOpen(true)
	}

	// "SSD" slot labels are not translated - they match the physical device markings
	const failedDriveLabel = failedDeviceSlot ? `SSD ${failedDeviceSlot}` : null

	// Pre-compute device states once for the shared mobile and desktop presentations.
	const ssdStates = displayedSsds.map(({device, slotNumber}) => {
		const raidDevice = device ? raidDevices.find((rd) => rd.id === device.id) : undefined
		const isReadyToAdd = !!device && readyToAddIds.has(device.id)
		const isInRaid = !!raidDevice
		const isFailedDrive = raidDevice && raidDevice.raidStatus !== 'ONLINE'
		const hasWarning = device && (isFailedDrive || getDeviceHealth(device).hasWarning || hasRaidErrors(raidDevice))
		return {device, slotNumber, isReadyToAdd, isInRaid, raidDevice, isFailedDrive, hasWarning}
	})

	const renderSsdAction = (state: (typeof ssdStates)[number], fullWidth = false) => {
		const {device, isReadyToAdd, isInRaid, isFailedDrive} = state
		const sizeClass = fullWidth ? 'w-full justify-center py-1 text-[12px]' : 'px-2 py-1 text-[11px]'

		if (isInRaid && device) {
			const member = raidStatus?.devices?.find((member) => member.id === device.id)
			if (!member) return null
			return (
				<DriveActionButton
					icon={TbRefreshDot}
					variant={isFailedDrive ? 'destructive' : 'default'}
					className={cn(fullWidth ? 'gap-1' : 'gap-0.5', sizeClass)}
					onClick={() => openMemberAction(member, device)}
				>
					{isFailedDrive ? t('storage-manager.replace') : t('storage-manager.swap')}
				</DriveActionButton>
			)
		}

		if (isReadyToAdd && device) {
			// The failed member's tray entry or fallback card owns the action. The
			// reserved spare only advertises that it is ready to replace that member.
			if (replacementCandidate && device.id === replacementCandidate.id) return null

			return (
				<button
					type='button'
					onClick={() => {
						setDeviceToAdd(device)
						setIsAddDialogOpen(true)
					}}
					className={cn(
						// Teal matches the freshly detected SSD this action belongs to (see SsdShape)
						'flex animate-pulse items-center rounded-full bg-[#1CBFAB] font-medium text-white transition-colors hover:bg-[#1CBFAB]/90',
						fullWidth ? 'gap-1' : 'gap-0.5',
						sizeClass,
					)}
				>
					{fullWidth ? (
						<TbPlus className='size-3' strokeWidth={3} />
					) : (
						<span className='flex size-3 items-center justify-center rounded-full bg-white/30'>
							<TbPlus className='size-2 text-white' strokeWidth={3} />
						</span>
					)}
					{t('storage-manager.add')}
				</button>
			)
		}

		return (
			<button
				type='button'
				onClick={() => setIsInstallSsdDialogOpen(true)}
				className={cn(
					'flex items-center rounded-full bg-brand font-medium text-white transition-colors hover:bg-brand/90',
					fullWidth ? 'gap-1' : 'gap-0.5',
					sizeClass,
				)}
			>
				{fullWidth ? (
					<TbPlus className='size-3' strokeWidth={3} />
				) : (
					<span className='flex size-3 items-center justify-center rounded-full bg-white'>
						<TbPlus className='size-2 text-brand' strokeWidth={3} />
					</span>
				)}
				{t('storage-manager.add')}
			</button>
		)
	}

	return (
		<ImmersiveDialog
			open={true}
			onOpenChange={(isOpen) => {
				if (!isOpen) {
					navigate('/settings')
				}
			}}
		>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent
					aria-describedby={undefined}
					size='md'
					showScroll
					style={{
						backgroundColor: 'rgba(8, 8, 8, 0.5)',
						backdropFilter: 'blur(80px)',
						boxShadow: '0px 32px 32px 0px #00000052, inset 1px 1px 1px 0px #FFFFFF14',
					}}
				>
					<div className='flex h-full flex-col gap-6'>
						<DialogTitle asChild>
							<h1 className={immersiveDialogTitleClass}>{t('storage-manager')}</h1>
						</DialogTitle>
						<StorageOperationError />
						<PoolDataErrorBanner errorCount={raidStatus?.dataErrors} />
						{raidStatus?.status === 'DEGRADED' && <StorageNotice>{t('storage-status.degraded-help')}</StorageNotice>}

						{/* Mode display */}
						<div className='flex flex-col gap-2.5'>
							<span className='text-13 font-semibold text-white/50'>{t('storage-manager.mode')}</span>
							<StorageModeDisplay value={raidType ?? 'storage'} canEnableFailsafe={canChooseMode ?? false} />
						</div>

						{/* Mixed-size FailSafe pools: explain where the unusable space comes from */}
						{!isStorageLoading && wastedBytes > 0 && (
							<div className='flex items-start gap-2 rounded-8 bg-white/5 p-2.5 text-13 leading-snug -tracking-2 text-white/50'>
								<TbInfoCircle className='h-5 w-5 shrink-0' />
								<span>{t('storage-manager.mixed-sizes-note', {size: formatStorageSize(minRoundedDriveSize)})}</span>
							</div>
						)}

						{/* Warning banner for missing/unavailable drive. Suppressed while loading:
						    getDevices can lag behind raid.getStatus after a drive is yanked, which
						    would briefly flag every pool member as missing. */}
						{!isStorageLoading && showMissingDriveWarning && (
							<div className='flex items-center gap-2 rounded-8 bg-[#3C1C1C] p-2.5 text-13 leading-tight -tracking-2 text-[#FF3434]'>
								<TbAlertTriangle className='h-5 w-5 shrink-0' />
								<span className='opacity-90'>
									{isUmbrelPro || hasKnownSsdPool
										? t('storage-manager.missing-ssd-warning')
										: t('storage-manager.missing-drive-warning')}
								</span>
							</div>
						)}

						<div className='flex flex-col gap-6 md:flex-1 md:flex-row md:items-stretch md:px-6'>
							<div
								className={cn('flex min-w-0 flex-col gap-6', isUmbrelPro ? 'md:w-[480px] md:shrink-0' : 'md:flex-1')}
							>
								{/* Mobile: SSD List Card */}
								<div className='flex flex-col gap-6 md:hidden'>
									<div className='flex flex-col rounded-xl bg-white/5 p-3'>
										{ssdStates.map(({device, slotNumber, isInRaid, isReadyToAdd, hasWarning}, i) => (
											<div
												key={`mobile-ssd-${slotNumber ?? device?.id ?? i}`}
												className='flex items-center justify-between gap-2 rounded-lg px-2 py-2'
											>
												{/* Left: Status + SSD info */}
												<div className='flex min-w-0 flex-1 items-center gap-2'>
													{/* Checkmark when device is in RAID, warning if issues, NEW badge for a
											    freshly detected drive (teal matches SsdShape) or its ready-to-replace
											    state when it's reserved for a failed drive, empty otherwise */}
													{isInRaid ? (
														hasWarning ? (
															<TbAlertTriangle className='size-5 shrink-0 text-[#F5A623]' />
														) : (
															<TbCircleCheckFilled className='size-5 shrink-0 text-brand' />
														)
													) : isReadyToAdd ? (
														replacementCandidate && device?.id === replacementCandidate.id ? (
															<span className='shrink-0 rounded-full bg-[#1CBFAB]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#2DD4BF]'>
																{t('storage-manager.ready-to-replace')}
															</span>
														) : (
															<span className='shrink-0 rounded-full bg-[#1CBFAB]/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[#2DD4BF] uppercase'>
																{t('storage-manager.new')}
															</span>
														)
													) : (
														<div className='size-5 shrink-0' />
													)}
													<span className='min-w-0 truncate text-[14px] font-medium text-white/60'>
														{slotNumber ? `SSD ${slotNumber}` : device?.name}
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
												<div className='flex shrink-0 items-center gap-2'>
													{/* Health pill - only when device present */}
													{device && (
														<button
															type='button'
															onClick={() => healthDialog.openDialog(device, slotNumber)}
															className='relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] p-1'
														>
															<TiInfoLarge className='size-4 text-white/60' />
															{hasWarning && (
																<span className='absolute -top-0.5 right-1.5'>
																	<span className='absolute inset-0 size-2.5 rounded-full bg-[#F5A623]' />
																	<span className='absolute inset-0 size-2.5 animate-ping rounded-full bg-[#F5A623] opacity-75' />
																</span>
															)}
														</button>
													)}

													{/* Action button - fixed width container for alignment */}
													<div className='w-[76px]'>{renderSsdAction(ssdStates[i], true)}</div>
												</div>
											</div>
										))}
										{!isUmbrelPro && (
											<button
												type='button'
												onClick={() => setIsInstallSsdDialogOpen(true)}
												className='mx-2 mt-1 flex items-center justify-center gap-1 rounded-full bg-brand py-1 text-[12px] font-medium text-white transition-colors hover:bg-brand/90'
											>
												<TbPlus className='size-3' strokeWidth={3} />
												{t('storage-manager.add')}
											</button>
										)}
									</div>
								</div>
								{/* Desktop: Device visualization */}
								<div className='hidden items-stretch md:flex'>
									{/* Left: Device visualization */}
									<div className={isUmbrelPro ? 'flex flex-col items-center gap-3' : 'hidden'}>
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
														className={cn(
															'absolute text-center font-medium',
															hasDevice ? 'text-white' : 'text-white/20',
														)}
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
																onHealthClick={() => healthDialog.openDialog(device, i + 1)}
																minRoundedDriveSize={minRoundedDriveSize}
																raidType={raidType}
																temperatureUnit={temperatureUnit}
																isReadyToAdd={readyToAddIds.has(device.id)}
																readyToAddLabel={
																	replacementCandidate && device.id === replacementCandidate.id
																		? failedDriveLabel
																			? t('storage-manager.ready-to-replace-ssd', {ssd: failedDriveLabel})
																			: t('storage-manager.ready-to-replace')
																		: undefined
																}
																raidDevice={raidDevices.find((rd) => rd.id === device.id)}
															/>
														)}
													</div>
												)
											})}

											{/* Action buttons below each slot */}
											{ssdStates.map((state, i) => (
												<div
													key={`button-${i}`}
													className='absolute flex justify-center'
													style={{
														left: `${12 + i * 20}%`,
														bottom: '4%',
														width: '15%',
													}}
												>
													{renderSsdAction(state)}
												</div>
											))}
										</div>
										<span className='text-13 font-semibold text-white/50'>{t('storage-manager.umbrel-pro')}</span>
									</div>

									{!isUmbrelPro && (
										<div className='relative min-w-0 flex-1 self-center rounded-[32px] border-[3px] border-transparent bg-[radial-gradient(78%_100%_at_50%_0%,_rgba(255,255,255,0.12)_0%,_rgba(255,255,255,0.04)_100%)] bg-clip-padding'>
											{/* Gradient border overlay */}
											<div
												className='pointer-events-none absolute -inset-[3px] z-10 rounded-[32px] p-[3px]'
												style={{
													background:
														'linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.05) 100%)',
													WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
													WebkitMaskComposite: 'xor',
													maskComposite: 'exclude',
												}}
											/>
											{isStorageLoading && (
												<div className='absolute inset-0 z-10 flex items-center justify-center rounded-[29px] bg-black/30'>
													<Spinner size='8' />
												</div>
											)}
											<div className='umbrel-hide-scrollbar w-full overflow-x-auto'>
												<div className='flex w-max min-w-full items-start justify-center gap-3 px-4 py-7'>
													{ssdStates.map((state) => {
														const {device, raidDevice, isReadyToAdd} = state
														if (!device) return null

														return (
															<div key={device.id} className='flex w-[120px] shrink-0 flex-col items-center gap-2'>
																<SsdShape
																	device={device}
																	onHealthClick={() => healthDialog.openDialog(device)}
																	minRoundedDriveSize={minRoundedDriveSize}
																	raidType={raidType}
																	temperatureUnit={temperatureUnit}
																	isReadyToAdd={isReadyToAdd}
																	readyToAddLabel={
																		replacementCandidate && device.id === replacementCandidate.id
																			? failedDriveLabel
																				? t('storage-manager.ready-to-replace-ssd', {ssd: failedDriveLabel})
																				: t('storage-manager.ready-to-replace')
																			: undefined
																	}
																	verticalName={device.name}
																	raidDevice={raidDevice}
																/>
																{renderSsdAction(state)}
															</div>
														)
													})}
													{/* Ghost slot inviting another SSD - aligned with the SSD bodies */}
													<button
														type='button'
														onClick={() => setIsInstallSsdDialogOpen(true)}
														className='mt-4 flex h-[340px] w-[85px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-[6px] border border-dashed border-white/15 text-white/50 transition-colors hover:border-white/30 hover:text-white/80'
													>
														<span className='flex size-8 items-center justify-center rounded-full bg-white/10'>
															<TbPlus className='size-4' strokeWidth={2.5} />
														</span>
														<span className='text-13 font-medium'>{t('storage-manager.add')}</span>
													</button>
												</div>
											</div>
										</div>
									)}
								</div>
								{!isStorageLoading &&
									raidStatus?.devices
										?.filter((member) => {
											const device = allDevices.find((candidate) => candidate.id === member.id)
											return !device || (isUmbrelPro && (!device.slot || device.slot < 1 || device.slot > 4))
										})
										.map((member) => {
											const device = allDevices.find((candidate) => candidate.id === member.id)
											return (
												<div key={member.id} className='flex min-w-0 flex-col gap-2'>
													<StorageDeviceCard
														device={device}
														fallbackType={isUmbrelPro ? 'ssd' : undefined}
														identifier={member.id}
														status={t(device ? 'storage-status.slot-unknown' : 'storage-status.not-detected')}
														onDetails={device ? () => healthDialog.openDialog(device) : undefined}
													/>
													<DriveActionButton
														icon={TbRefreshDot}
														variant={member.status === 'ONLINE' ? 'default' : 'destructive'}
														className='self-end'
														onClick={() => openMemberAction(member, device)}
													>
														{t(member.status === 'ONLINE' ? 'storage-manager.swap' : 'storage-manager.replace')}
													</DriveActionButton>
												</div>
											)
										})}
								{!isStorageLoading && replacementCandidate && (
									<p className='text-13 leading-relaxed text-white/50'>
										<span className='text-white/80'>
											{replacementCandidate.name} · {formatStorageSize(replacementCandidate.size)}:{' '}
										</span>
										{t('storage-manager.ready-to-replace-description')}
									</p>
								)}
								{!isStorageLoading && (
									<OtherDrives
										drives={availableHdds}
										description={
											!raidStatus?.exists ? (
												<p>{t('storage-manager.other-drives.pool-unavailable')}</p>
											) : !isUmbrelPro && !hasKnownSsdPool ? (
												<p>
													{hasMissingDrive
														? t('storage-manager.other-drives.pool-drives-missing')
														: t('storage-manager.other-drives.setup-unavailable')}
												</p>
											) : isUmbrelPro ? (
												<p>{t('storage-manager.other-drives.pro')}</p>
											) : (
												<StorageMigrationDescription variant='hdd' />
											)
										}
										onHealthClick={(device) => healthDialog.openDialog(device)}
									/>
								)}
								<UsbDrives />
								<MdadmSection />
							</div>
							{/* Right: Storage info, top-aligned except for Umbrel Pro's centered summary.
							    On slotless trays the column keeps a fixed width so the SSD tray gets the room. */}
							<div
								className={cn(
									'relative flex flex-col items-center gap-4',
									isUmbrelPro ? 'justify-center md:flex-1' : 'md:w-[240px] md:shrink-0 md:pt-6',
								)}
							>
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
				onOpenChange={(open) => {
					setIsSwapDialogOpen(open)
					if (!open) {
						setSwapSlot(null)
						setSwapDeviceId(null)
					}
				}}
				raidType={raidType}
				slot={swapSlot}
				oldDeviceId={swapDeviceId}
				oldDeviceFailed={
					swapDeviceId
						? raidStatus?.devices?.some((member) => member.id === swapDeviceId && member.status !== 'ONLINE')
						: ssdStates.some((state) => state.isFailedDrive && state.slotNumber === swapSlot)
				}
				isUmbrelPro={isUmbrelPro}
				raidStatus={raidStatus}
				// SSD pools must be offered SSD replacements only - an unpooled rotational disk
				// would be rejected by the backend's type check
				availableDevices={availableSsds}
				missingDeviceType='ssd'
				allDevices={allDevices}
				replaceDeviceAsync={replaceDeviceAsync}
			/>

			{/* Replace Failed Drive Dialog (for degraded arrays) - targets the member whose
			    Replace was clicked, not just the first failed one */}
			<ReplaceFailedDriveDialog
				open={isReplaceFailedDialogOpen}
				onOpenChange={(open) => {
					setIsReplaceFailedDialogOpen(open)
					if (!open) {
						setDeviceForReplacement(null)
						setFailedIdForReplacement(null)
					}
				}}
				newDevice={deviceForReplacement}
				raidType={raidType}
				failedDevice={failedRaidDevices.find((rd) => rd.id === failedIdForReplacement) ?? primaryFailed ?? null}
				failedSlot={
					failedIdForReplacement
						? proSlotFor(allDevices.find((d) => d.id === failedIdForReplacement))
						: failedDeviceSlot
				}
				minRoundedDriveSize={replacementSizeFor(failedIdForReplacement ?? primaryFailed?.id)}
				replaceDeviceAsync={replaceDeviceAsync}
			/>
		</ImmersiveDialog>
	)
}
