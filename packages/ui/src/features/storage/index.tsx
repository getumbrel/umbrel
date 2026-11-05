import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {
	TbAlertTriangle,
	TbAlertTriangleFilled,
	TbCircleCheckFilled,
	TbInfoCircle,
	TbPlus,
	TbRefreshDot,
} from 'react-icons/tb'
import {TiInfoLarge} from 'react-icons/ti'
import {useNavigate} from 'react-router-dom'

import {DialogPortal, DialogTitle} from '@/components/ui/dialog'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {Spinner} from '@/components/ui/loading'
import {ScrollArea} from '@/components/ui/scroll-area'
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
import {OtherDrives, StorageMigrationDescription} from './components/other-drives'
import {PoolDataErrorBanner} from './components/pool-data-error-banner'
import SingleDriveStorageManager from './components/single-drive'
import {SsdCard} from './components/ssd-card'
import {SsdRow} from './components/ssd-row'
import {SsdShape} from './components/ssd-shape'
import {StorageDeviceCard} from './components/storage-device-card'
import {StorageDonutChart} from './components/storage-donut-chart'
import {StorageModeDisplay} from './components/storage-mode-display'
import {StorageNotice} from './components/storage-page'
import {StorageStats} from './components/storage-stats'
import {StorageUnavailable} from './components/storage-unavailable'
import {UsbDrives} from './components/usb-drives'
import {getDeviceHealth, pickReplacementDrive, RaidStatus, StorageDevice, useStorage} from './hooks/use-storage'
import {canRepairInPlace, formatStorageSize, getPoolDeviceType, getRememberedMemberSize, hasRaidErrors} from './utils'

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
	// at least that much), otherwise the size the pool remembers for it, and failing that the
	// smallest pool drive as a lower bound
	const replacementSizeFor = (failedId: string | undefined) => {
		const failedDevice = failedId ? allDevices.find((d) => d.id === failedId) : undefined
		return failedDevice?.roundedSize ?? getRememberedMemberSize(raidStatus, failedId) ?? minRoundedDriveSize
	}

	const repairDriveFor = (member: {id: string; status?: string}) =>
		pickReplacementDrive(
			availableSsds,
			replacementSizeFor(member.id),
			canRepairInPlace(raidStatus, member, allDevices) ? allDevices.find((d) => d.id === member.id) : undefined,
		)

	// One clear repair path when the pool is degraded and a new SSD is attached: the failed
	// drive's Replace opens the replace dialog with this candidate pre-selected, while the
	// new SSD itself just advertises that it's ready (no second button). An SSD that won't be
	// used for the repair is never reserved - it keeps its normal Add flow instead.
	const primaryFailed = failedRaidDevices[0]
	const primaryRepairDrive = canReplaceFailedSsd && primaryFailed ? repairDriveFor(primaryFailed) : undefined
	const replacementCandidate = availableSsds.find((drive) => drive.id === primaryRepairDrive?.id)
	// The member the replace dialog is working on. It can recover or be repaired while the dialog
	// is open, and the dialog must then close rather than quietly retarget another failed drive.
	const replacementTarget = failedRaidDevices.find((rd) => rd.id === failedIdForReplacement) ?? null
	const closeReplaceDialog = () => {
		setIsReplaceFailedDialogOpen(false)
		setDeviceForReplacement(null)
		setFailedIdForReplacement(null)
	}
	useEffect(() => {
		if (isReplaceFailedDialogOpen && !replacementTarget) closeReplaceDialog()
	}, [isReplaceFailedDialogOpen, replacementTarget])

	const proSlotFor = (device?: StorageDevice) =>
		isUmbrelPro && device?.slot && device.slot >= 1 && device.slot <= 4 ? device.slot : null
	const failedDeviceSlot = proSlotFor(allDevices.find((d) => d.id === primaryFailed?.id))

	// Every member has one repair entry point, whether it appears in the tray or
	// a fallback card. Prefer a healthy spare, then repair an attached failed disk
	// in place where that's safe (for example, after its labels were lost). Anything
	// else needs a new drive inserting.
	const openMemberAction = (member: NonNullable<RaidStatus['devices']>[number], device?: StorageDevice) => {
		const candidate = member.status !== 'ONLINE' ? repairDriveFor(member) : undefined
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

	// With no physical layout to mirror, the drives that need the user come first so they're never
	// scrolled away. Temperature doesn't count: a drive hovering at its limit would keep swapping
	// rows on each poll, moving buttons out from under the pointer.
	const ssdUrgency = ({device, raidDevice, isFailedDrive, isReadyToAdd}: (typeof ssdStates)[number]) => {
		if (!device) return 3
		const {smartUnhealthy, lifeWarning} = getDeviceHealth(device)
		if (isFailedDrive || smartUnhealthy) return 0
		if (isReadyToAdd) return 1
		return lifeWarning || hasRaidErrors(raidDevice) ? 2 : 3
	}
	const ssdRows = isUmbrelPro ? ssdStates : [...ssdStates].sort((a, b) => ssdUrgency(a) - ssdUrgency(b))

	// Pool members with no place in the tray or list: a missing drive, or one in an unknown Pro slot
	const unplacedMembers = (raidStatus?.devices ?? []).filter((member) => {
		const device = allDevices.find((candidate) => candidate.id === member.id)
		return !device || (isUmbrelPro && (!device.slot || device.slot < 1 || device.slot > 4))
	})
	const renderUnplacedAction = (
		member: NonNullable<RaidStatus['devices']>[number],
		device: StorageDevice | undefined,
		className: string,
	) => (
		<DriveActionButton
			icon={TbRefreshDot}
			variant={member.status === 'ONLINE' ? 'default' : 'destructive'}
			className={className}
			onClick={() => openMemberAction(member, device)}
		>
			{t(member.status === 'ONLINE' ? 'storage-manager.swap' : 'storage-manager.replace')}
		</DriveActionButton>
	)

	// Compact fits under a tray slot, wide fills the phone list's fixed column, and regular sits in an SSD row
	const renderSsdAction = (state: (typeof ssdStates)[number], size: 'compact' | 'wide' | 'regular') => {
		const {device, isReadyToAdd, isInRaid, isFailedDrive} = state
		const fullWidth = size !== 'compact'
		const sizeClass = {
			compact: 'px-2 py-1 text-[11px]',
			wide: 'w-full justify-center py-1 text-[12px]',
			regular: 'justify-center px-3 py-1 text-[12px]',
		}[size]

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
					short={!isUmbrelPro}
					showScroll
					style={{
						backgroundColor: 'rgba(8, 8, 8, 0.5)',
						backdropFilter: 'blur(80px)',
						boxShadow: '0px 32px 32px 0px #00000052, inset 1px 1px 1px 0px #FFFFFF14',
					}}
				>
					<div className='flex h-full flex-col gap-6'>
						<DialogTitle asChild className={immersiveDialogTitleClass}>
							<h1>{t('storage-manager')}</h1>
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
							<StorageNotice tone='danger'>
								{isUmbrelPro || hasKnownSsdPool
									? t('storage-manager.missing-ssd-warning')
									: t('storage-manager.missing-drive-warning')}
							</StorageNotice>
						)}

						<div className={cn('flex flex-col gap-6 md:flex-1 md:flex-row md:items-stretch', isUmbrelPro && 'md:px-6')}>
							<div
								className={cn('flex min-w-0 flex-col gap-6', isUmbrelPro ? 'md:w-[480px] md:shrink-0' : 'md:flex-1')}
							>
								{/* A missing drive has no row in the list, and it's the one that needs the user most.
								    The negative margin closes the column's gap so it reads as the top of the list. */}
								{!isStorageLoading && !isUmbrelPro && unplacedMembers.length > 0 && (
									<div className='flex flex-col gap-2.5 md:-mb-3.5'>
										{unplacedMembers.map((member) => {
											const rememberedSize = getRememberedMemberSize(raidStatus, member.id)
											return (
												<SsdCard
													key={member.id}
													size={rememberedSize ? formatStorageSize(rememberedSize) : ''}
													model={member.id}
													variant='critical'
													status={
														<span className='flex items-center gap-1 text-[12px] font-semibold whitespace-nowrap text-white'>
															<TbAlertTriangleFilled className='size-3.5' />
															{t('storage-status.not-detected')}
														</span>
													}
													action={renderUnplacedAction(member, undefined, 'justify-center gap-1 px-3 py-1 text-[12px]')}
												/>
											)
										})}
									</div>
								)}
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
											    freshly detected drive (teal matches SsdShape), empty otherwise */}
													{isInRaid ? (
														hasWarning ? (
															<TbAlertTriangle className='size-5 shrink-0 text-[#F5A623]' />
														) : (
															<TbCircleCheckFilled className='size-5 shrink-0 text-brand' />
														)
													) : isReadyToAdd ? (
														<span className='shrink-0 rounded-full bg-[#1CBFAB]/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[#2DD4BF] uppercase'>
															{t('storage-manager.new')}
														</span>
													) : (
														<div className='size-5 shrink-0' />
													)}
													<div className='min-w-0'>
														{/* Only a model name truncates, so the size after it stays in view */}
														<div className='flex text-[14px] font-medium text-white/60'>
															<span className='truncate'>{slotNumber ? `SSD ${slotNumber}` : device?.name}</span>
															<span className='shrink-0 whitespace-pre'>
																{device ? (
																	<>
																		{' · '}
																		<span className='text-white'>{formatStorageSize(device.size)}</span>
																	</>
																) : (
																	<span className='text-white/40'> · {t('storage-manager.empty')}</span>
																)}
															</span>
														</div>
														{/* A spare held for a failed drive says so under its name. It has no
														    action of its own (that's on the failed drive's row), so its row
														    gives the name the action's room too, and the words fit on one line */}
														{replacementCandidate && device?.id === replacementCandidate.id && (
															<span className='mt-0.5 inline-block max-w-full truncate rounded-full bg-[#1CBFAB]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#2DD4BF]'>
																{t('storage-manager.ready-to-replace')}
															</span>
														)}
													</div>
												</div>

												{/* Right: Health pill + Action button */}
												<div className='flex shrink-0 items-center gap-2'>
													{/* Health pill - only when device present */}
													{device && (
														<button
															type='button'
															onClick={() => healthDialog.openDialog(device, slotNumber)}
															aria-label={t('storage-status.drive-details', {name: device.name})}
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

													{/* Action button - a minimum width keeps the usual labels aligned,
													    and a longer one widens it instead of crushing its icon */}
													<div className='min-w-[76px] empty:hidden'>{renderSsdAction(ssdStates[i], 'wide')}</div>
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
													{renderSsdAction(state, 'compact')}
												</div>
											))}
										</div>
										<span className='text-13 font-semibold text-white/50'>{t('storage-manager.umbrel-pro')}</span>
									</div>

									{!isUmbrelPro && (
										<div className='flex min-w-0 flex-1 flex-col gap-2.5'>
											{/* The list is capped at four drives and a peek of the fifth, less on short windows. Its scrollbar
											    hangs in the gutter beside it, so drives keep their width whether or not it's needed. */}
											<ScrollArea
												type='always'
												className='-mr-3.5 max-h-[clamp(240px,calc(100dvh-400px),372px)] [&>[data-radix-scroll-area-viewport]]:max-h-[inherit]'
											>
												<div className='flex flex-col gap-2.5 pr-3.5'>
													{ssdRows.map((state) => {
														const {device, raidDevice, isReadyToAdd} = state
														if (!device) return null

														return (
															<SsdRow
																key={device.id}
																device={device}
																raidDevice={raidDevice}
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
																onHealthClick={() => healthDialog.openDialog(device)}
																action={renderSsdAction(state, 'regular')}
															/>
														)
													})}
												</div>
											</ScrollArea>
											{/* Empty slot inviting another SSD. Pinned under the list, so it's reachable however many are attached */}
											<button
												type='button'
												onClick={() => setIsInstallSsdDialogOpen(true)}
												className='flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-white/50 transition-colors hover:border-white/30 hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-hidden'
											>
												<TbPlus className='size-4' strokeWidth={2.5} />
												<span className='text-13 font-medium'>{t('storage-manager.add')}</span>
											</button>
										</div>
									)}
								</div>
								{!isStorageLoading &&
									isUmbrelPro &&
									unplacedMembers.map((member) => {
										const device = allDevices.find((candidate) => candidate.id === member.id)
										return (
											<div key={member.id} className='flex min-w-0 flex-col gap-2'>
												<StorageDeviceCard
													device={device}
													fallbackType='ssd'
													identifier={member.id}
													status={t(device ? 'storage-status.slot-unknown' : 'storage-status.not-detected')}
													onDetails={device ? () => healthDialog.openDialog(device) : undefined}
												/>
												{renderUnplacedAction(member, device, 'self-end')}
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
							</div>
							{/* Right: Storage info, top-aligned except for Umbrel Pro's centered summary.
							    On slotless trays the column keeps a fixed width so the SSD tray gets the room. */}
							<div
								className={cn(
									'relative flex flex-col items-center gap-4',
									isUmbrelPro ? 'justify-center md:flex-1' : 'md:w-[240px] md:shrink-0',
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
				poolStatus={raidStatus?.status}
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
					if (!open) closeReplaceDialog()
				}}
				newDevice={deviceForReplacement}
				raidType={raidType}
				failedDevice={replacementTarget}
				failedSlot={proSlotFor(allDevices.find((d) => d.id === failedIdForReplacement))}
				minRoundedDriveSize={replacementSizeFor(failedIdForReplacement ?? undefined)}
				replaceDeviceAsync={replaceDeviceAsync}
			/>
		</ImmersiveDialog>
	)
}
