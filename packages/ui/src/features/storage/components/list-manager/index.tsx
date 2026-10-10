import {DialogPortal, DialogTitle} from '@radix-ui/react-dialog'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {TbAlertTriangle} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {Spinner} from '@/components/ui/loading'
import {StorageOperationError} from '@/features/storage/components/storage-operation-error'
import {MdadmSection} from '@/features/storage/components/mdadm-section'

import {RaidDeviceStatus, StorageDevice, useStorage} from '../../hooks/use-storage'
import {formatStorageSize, planFailsafeTransition, planMirrorAdditions} from '../../utils'
import {AddAcceleratorDialog} from '../dialogs/add-accelerator-dialog'
import {AddMirrorDialog} from '../dialogs/add-mirror-dialog'
import {AddToRaidDialog} from '../dialogs/add-to-raid-dialog'
import {EnableFailsafeDialog} from '../dialogs/enable-failsafe-dialog'
import {InstallSsdDialog} from '../dialogs/install-ssd-dialog'
import {ReplaceFailedDriveDialog} from '../dialogs/replace-failed-drive-dialog'
import {SsdHealthDialog, useSsdHealthDialog} from '../dialogs/ssd-health-dialog'
import {SwapDialog} from '../dialogs/swap-dialog'
import {PoolDataErrorBanner} from '../pool-data-error-banner'
import {StorageDonutChart} from '../storage-donut-chart'
import {StorageModeDisplay} from '../storage-mode-display'
import {StorageNotice} from '../storage-page'
import {StorageStats} from '../storage-stats'
import {UsbDrives} from '../usb-drives'
import {AcceleratorSection} from './accelerator-section'
import {
	AddIcon,
	DriveActionButton,
	DriveCard,
	MissingDriveCard,
	ReadyToReplacePill,
	ReplaceIcon,
	SystemDriveCard,
} from './drive-card'
import {PairCard, PairDriveCell, PairMissingCell, PairPlaceholderCell} from './mirror-pair-card'

type FailedDevice = {
	id: string
	status: RaidDeviceStatus
	readErrors: number
	writeErrors: number
	checksumErrors: number
}

// List-based storage manager for devices without dedicated SSD slots (everything except
// Umbrel Pro, which renders the physical tray instead). Handles both HDD pools (mirror
// FailSafe + SSD acceleration) and SSD pools (raidz FailSafe).
export function ListStorageManager() {
	const {t} = useTranslation()
	const navigate = useNavigate()

	// Poll every 15 seconds to keep temperature and health status up to date
	const {
		allDevices,
		raidDevices,
		availableHdds,
		availableSsds,
		availableDevices,
		systemDrives,
		poolDeviceType,
		mirrorPairs,
		acceleratorDevices,
		inactiveBytes,
		chartData,
		usedSpace,
		availableBytes,
		failsafeOverheadBytes,
		wastedBytes,
		totalCapacityBytes,
		raidType,
		raidStatus,
		canChooseMode,
		failedRaidDevices,
		canReplaceFailedDevice,
		isLoading: isStorageLoading,
		addDeviceAsync,
		transitionToFailsafeAsync,
		replaceDeviceAsync,
		addMirrorAsync,
		addAcceleratorAsync,
		transitionToFailsafeMirrorAsync,
	} = useStorage({pollInterval: 15_000})

	const isHddPool = poolDeviceType === 'hdd'
	const isFailsafe = raidType === 'failsafe'

	// Unpooled drives shown in the drives section. On HDD pools the unpooled SSDs live in the
	// acceleration section instead; on SSD pools everything is listed (HDDs render without an
	// add action since SSDs and HDDs can't mix in one array).
	const unpooledDrives = isHddPool ? availableHdds : availableDevices

	// Health dialog - device looked up from live data so polling keeps it fresh
	const healthDialog = useSsdHealthDialog()
	const healthDialogDevice = allDevices?.find((d) => !!d.id && d.id === healthDialog.selectedDevice?.deviceId)

	// Dialog state
	const [deviceToAdd, setDeviceToAdd] = useState<StorageDevice | null>(null)
	const [mirrorToAdd, setMirrorToAdd] = useState<[StorageDevice, StorageDevice] | null>(null)
	const [acceleratorToAdd, setAcceleratorToAdd] = useState<StorageDevice[] | null>(null)
	const [isEnableFailsafeOpen, setIsEnableFailsafeOpen] = useState(false)
	const [isInstallDrivesOpen, setIsInstallDrivesOpen] = useState(false)
	const [swapDeviceId, setSwapDeviceId] = useState<string | null>(null)

	// Swap replacement candidates match the swapped device's type: an accelerator SSD on an
	// HDD pool must be offered SSDs, not HDDs. A missing member has no attached device to
	// read the type from, so its pool role decides.
	const swapDevice = allDevices.find((d) => d.id === swapDeviceId)
	const swapMemberIsAccelerator = !swapDevice && acceleratorDevices.some((member) => member.id === swapDeviceId)
	const swapCandidates =
		swapDevice?.type === 'ssd' || swapMemberIsAccelerator || (!swapDevice && !isHddPool) ? availableSsds : availableHdds
	const [replaceTarget, setReplaceTarget] = useState<{
		failed: FailedDevice
		newDevice: StorageDevice
		minSize: number
	} | null>(null)

	// Replacement candidates: largest unpooled drive of the right type
	const replacementHdd = [...availableHdds].sort((a, b) => b.roundedSize - a.roundedSize)[0]
	const replacementSsd = [...availableSsds].sort((a, b) => b.roundedSize - a.roundedSize)[0]

	// Missing physical devices can't be cross-checked against the pool device type, so data
	// drives use the pool's type for their replacement candidate
	const dataReplacementCandidate = isHddPool ? replacementHdd : replacementSsd

	// A failed member whose physical drive is still attached but no longer recognised by
	// the pool (wiped or corrupted labels) can be replaced with its own disk in place -
	// availableDevices excludes it because its id matches a pool member, so look it up
	// directly. A fresh unpooled drive is preferred when one is attached.
	const selfReplacementFor = (member: {id: string; status?: RaidDeviceStatus}, type: 'hdd' | 'ssd') => {
		const isFailed = member.status !== undefined && member.status !== 'ONLINE'
		if (!isFailed) return undefined
		return allDevices.find((device) => device.id === member.id && device.type === type && !device.isSystemDrive)
	}
	// Candidates must be large enough for the member they'd replace - a fresh drive is
	// preferred, but a too-small fresh drive doesn't shadow a viable self-replacement.
	// Members with no usable candidate fall back to the physical-swap instructions.
	const dataCandidateFor = (member: {id: string; status?: RaidDeviceStatus}) =>
		[dataReplacementCandidate, selfReplacementFor(member, isHddPool ? 'hdd' : 'ssd')].find(
			(candidate): candidate is StorageDevice => !!candidate && candidate.roundedSize >= minReplacementSize(member.id),
		)
	const acceleratorCandidateFor = (member: {id: string; status?: RaidDeviceStatus}) =>
		[replacementSsd, selfReplacementFor(member, 'ssd')].find(
			(candidate): candidate is StorageDevice => !!candidate && candidate.roundedSize >= minReplacementSize(member.id),
		)

	// Minimum size the replacement drive must have: the failed member's own size when we still
	// know it, otherwise the smallest pool drive. A missing accelerator member is sized from
	// its surviving partner instead - the backend partitions the replacement to mirror the
	// partner, so the data-pool (HDD) sizes are irrelevant for it.
	const minReplacementSize = (failedId: string) => {
		const failedDevice = allDevices.find((d) => d.id === failedId)
		if (failedDevice) return failedDevice.roundedSize
		if (acceleratorDevices.some((member) => member.id === failedId)) {
			const partner = acceleratorDevices.find((member) => member.id !== failedId && member.device)
			// No surviving partner to size against - let the backend's own validation decide
			return partner?.device?.roundedSize ?? 0
		}
		const poolSizes = raidDevices.map((d) => d.roundedSize)
		return poolSizes.length > 0 ? Math.min(...poolSizes) : 0
	}

	const openReplaceDialog = (failed: {id: string; status: RaidDeviceStatus}, newDevice?: StorageDevice) => {
		if (!newDevice) return
		const fullFailed = failedRaidDevices.find((d) => d.id === failed.id)
		setReplaceTarget({
			failed: {
				id: failed.id,
				status: failed.status,
				readErrors: fullFailed?.readErrors ?? 0,
				writeErrors: fullFailed?.writeErrors ?? 0,
				checksumErrors: fullFailed?.checksumErrors ?? 0,
			},
			newDevice,
			minSize: minReplacementSize(failed.id),
		})
	}

	// Storage -> FailSafe transition (HDD pools only, and only while the pool is healthy with
	// every member physically attached)
	const transitionPlan = planFailsafeTransition({
		poolDrives: raidDevices,
		unpooledDrives: availableHdds,
		unpooledSsds: availableSsds,
		acceleratorDevice: acceleratorDevices[0]?.device,
	})
	const allPoolDrivesAttached = raidDevices.length === (raidStatus?.devices?.length ?? 0)
	const showEnableFailsafe =
		isHddPool &&
		raidType === 'storage' &&
		raidStatus?.topology === 'stripe' &&
		allPoolDrivesAttached &&
		// A detached accelerator SSD silently drops out of the transition plan, which would
		// claim ready while the backend is guaranteed to reject the transition
		!acceleratorDevices.some((member) => !member.device) &&
		raidDevices.length > 0

	// Check if any RAID device doesn't have a matching physical device
	const hasMissingDrive = raidStatus?.devices?.some((rd) => !allDevices.find((d) => d.id === rd.id))
	const hasMissingAccelerator = acceleratorDevices.some((member) => !member.device)

	// Whether an accelerator member replacement is currently possible (candidateFor only
	// returns SSDs that are large enough)
	const canReplaceAccelerator = acceleratorDevices.some(
		(member) =>
			(member.status !== 'ONLINE' || !member.device) &&
			!!acceleratorCandidateFor({id: member.id, status: member.status}),
	)
	// The section's ready-to-replace pill advertises the actual resolved candidate - the
	// largest unpooled SSD can be an undersized red herring while the real repair is a
	// self-replacement (which needs no pill; its own member row carries the state)
	const failedAcceleratorMember = acceleratorDevices.find((member) => member.status !== 'ONLINE' || !member.device)
	const acceleratorReplacementCandidate = failedAcceleratorMember
		? acceleratorCandidateFor({id: failedAcceleratorMember.id, status: failedAcceleratorMember.status})
		: undefined

	// Action button for a pool member: healthy drives can be proactively swapped, failed
	// drives get a replace flow (direct replacement when a large-enough candidate drive is
	// attached, otherwise instructions for physically swapping the drive)
	const memberAction = (member: {id: string; status?: RaidDeviceStatus}) => {
		const candidate = dataCandidateFor(member)
		const isFailed = member.status !== undefined && member.status !== 'ONLINE'
		if (isFailed && candidate) {
			return (
				<DriveActionButton
					icon={ReplaceIcon}
					variant='destructive'
					onClick={() => openReplaceDialog({id: member.id, status: member.status!}, candidate)}
				>
					{t('storage-manager.replace')}
				</DriveActionButton>
			)
		}
		return (
			<DriveActionButton
				icon={ReplaceIcon}
				variant={isFailed ? 'destructive' : 'default'}
				onClick={() => setSwapDeviceId(member.id)}
			>
				{isFailed ? t('storage-manager.replace') : t('storage-manager.swap')}
			</DriveActionButton>
		)
	}

	// --- Drives section content ---
	let drivesContent: React.ReactNode
	if (isHddPool && isFailsafe) {
		// Mirror pairs + unpooled drive pairing. The replacement candidate for a failed or
		// missing member stays out of the pairing plan - it's reserved for the failed
		// drive's Replace action and shows up with a status pill instead.
		const primaryFailed = failedRaidDevices[0]
		// dataCandidateFor only returns drives large enough to take over - an undersized
		// drive stays available for pairing instead
		const mirrorReplacementCandidate =
			canReplaceFailedDevice && primaryFailed
				? dataCandidateFor({id: primaryFailed.id, status: primaryFailed.status})
				: undefined
		const candidateIsUnpooled = availableHdds.some((drive) => drive.id === mirrorReplacementCandidate?.id)
		const pairableDrives = candidateIsUnpooled
			? availableHdds.filter((drive) => drive.id !== mirrorReplacementCandidate?.id)
			: availableHdds
		const {pairs: addablePairs, unpaired} = planMirrorAdditions(pairableDrives)
		drivesContent = (
			<div className='flex flex-col gap-3'>
				{mirrorPairs.map((members, index) => {
					const pairHasIssue = members.some((member) => !member.raidDevice || member.status !== 'ONLINE')
					const cells = members
						.slice(0, 2)
						.map((member) =>
							member.raidDevice ? (
								<PairDriveCell
									key={member.id}
									device={member.raidDevice}
									raidDevice={member.raidDevice}
									onClick={() => healthDialog.openDialog(member.raidDevice!)}
									action={memberAction({id: member.id, status: member.status})}
								/>
							) : (
								<PairMissingCell
									key={member.id}
									id={member.id}
									status={member.status}
									action={memberAction({id: member.id, status: member.status})}
								/>
							),
						)
					return <PairCard key={index} badge={pairHasIssue ? 'broken' : 'protected'} left={cells[0]} right={cells[1]} />
				})}

				{/* New unpooled drives: a section label ties the candidate/pairable/unpaired
				    cards together as freshly detected hardware */}
				{(candidateIsUnpooled || addablePairs.length > 0 || unpaired.length > 0) && (
					<span className='mt-1 text-13 font-semibold text-white/50'>{t('storage-manager.new-drives-detected')}</span>
				)}

				{/* A new drive reserved to replace a failed pool member */}
				{candidateIsUnpooled && mirrorReplacementCandidate && (
					<DriveCard
						device={mirrorReplacementCandidate}
						inPool={false}
						onClick={() => healthDialog.openDialog(mirrorReplacementCandidate)}
						pill={<ReadyToReplacePill />}
						description={t('storage-manager.ready-to-replace-description')}
					/>
				)}

				{/* Two unpooled drives ready to join as a new pair */}
				{addablePairs.map(([first, second]) => (
					<div key={first.id} className='flex flex-col items-center gap-3'>
						<PairCard
							badge='add'
							left={<PairDriveCell device={first} inactive onClick={() => healthDialog.openDialog(first)} />}
							right={<PairDriveCell device={second} inactive onClick={() => healthDialog.openDialog(second)} />}
						/>
						<DriveActionButton icon={AddIcon} variant='primary' onClick={() => setMirrorToAdd([first, second])}>
							{t('storage-manager.add-mirror.add-drives-to-storage')}
						</DriveActionButton>
					</div>
				))}

				{/* A single unpooled drive waiting for a partner */}
				{unpaired.map((drive) => (
					<PairCard
						key={drive.id}
						broken
						badge='broken'
						left={<PairDriveCell device={drive} inactive onClick={() => healthDialog.openDialog(drive)} />}
						right={
							<PairPlaceholderCell
								title={t('storage-manager.pair-placeholder', {size: formatStorageSize(drive.size)})}
								description={t('storage-manager.pair-placeholder-description')}
							/>
						}
					/>
				))}
			</div>
		)
	} else {
		// Full Storage HDDs stay one drive per row at every screen size. Unpooled
		// drives get their own labeled group below the pool members.
		drivesContent = (
			<div className='flex flex-col gap-2.5'>
				<div className='grid grid-cols-1 gap-3'>
					{(raidStatus?.devices ?? []).map((poolDevice) => {
						const device = allDevices.find((d) => d.id === poolDevice.id)
						const raidDevice = raidDevices.find((d) => d.id === poolDevice.id)
						if (!device) {
							return (
								<MissingDriveCard
									key={poolDevice.id}
									id={poolDevice.id}
									status={poolDevice.status}
									action={memberAction({id: poolDevice.id, status: poolDevice.status})}
									isHdd={isHddPool}
								/>
							)
						}
						return (
							<DriveCard
								key={poolDevice.id}
								device={device}
								raidDevice={raidDevice}
								inPool
								onClick={() => healthDialog.openDialog(device)}
								action={memberAction({id: poolDevice.id, status: poolDevice.status})}
							/>
						)
					})}
				</div>

				{unpooledDrives.length > 0 && (
					<span className='mt-1 text-13 font-semibold text-white/50'>{t('storage-manager.new-drives-detected')}</span>
				)}
				{unpooledDrives.length > 0 && (
					<div className='grid grid-cols-1 gap-3'>
						{unpooledDrives.map((device) => {
							// Drives matching the pool type can be added; mismatched types can't be mixed.
							// The replacement candidate for a failed member gets a status pill instead of a
							// button - the Replace action lives on the failed drive's own row.
							const matchesPool = device.type === poolDeviceType
							const primaryFailed = failedRaidDevices[0]
							const isReplacementCandidate =
								matchesPool &&
								canReplaceFailedDevice &&
								!!primaryFailed &&
								dataCandidateFor({id: primaryFailed.id, status: primaryFailed.status})?.id === device.id
							return (
								<DriveCard
									key={device.id}
									device={device}
									inPool={false}
									onClick={() => healthDialog.openDialog(device)}
									pill={isReplacementCandidate ? <ReadyToReplacePill /> : undefined}
									description={isReplacementCandidate ? t('storage-manager.ready-to-replace-description') : undefined}
									action={
										!isReplacementCandidate && matchesPool ? (
											<DriveActionButton icon={AddIcon} variant='primary' onClick={() => setDeviceToAdd(device)}>
												{t('storage-manager.add')}
											</DriveActionButton>
										) : undefined
									}
								/>
							)
						})}
					</div>
				)}
			</div>
		)
	}

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

						{/* Mode display - full width above the drive/stats columns */}
						<div className='flex flex-col gap-2.5'>
							<span className='text-13 font-semibold text-white/50'>{t('storage-manager.mode')}</span>
							<StorageModeDisplay
								value={raidType ?? 'storage'}
								canEnableFailsafe={isHddPool ? raidType === 'storage' : (canChooseMode ?? false)}
								copyVariant={isHddPool ? 'drive' : 'ssd'}
							/>
						</div>

						{/* Warning banner for missing/unavailable drive - full width like the mode cards.
						    Suppressed while loading: getDevices can lag behind raid.getStatus by many
						    seconds (a yanked drive blocks smartctl until the kernel drops the device),
						    and an empty device list would otherwise flag every pool member as missing. */}
						{!isStorageLoading && (hasMissingDrive || hasMissingAccelerator) && (
							<div className='flex items-center gap-2 rounded-8 bg-[#3C1C1C] p-2.5 text-13 leading-tight -tracking-2 text-[#FF3434]'>
								<TbAlertTriangle className='h-5 w-5 shrink-0' />
								<span className='opacity-90'>
									{isHddPool ? t('storage-manager.missing-drive-warning') : t('storage-manager.missing-ssd-warning')}
								</span>
							</div>
						)}

						<div className='flex flex-col gap-6 md:flex-row md:items-stretch'>
							{/* Left: mode, drives, acceleration */}
							<div className='flex min-w-0 flex-1 flex-col gap-6'>
								{/* Attached drives */}
								<div className='flex flex-col gap-2.5'>
									<div className='flex items-center justify-between'>
										<span className='text-13 font-semibold text-white/50'>{t('storage-manager.attached-drives')}</span>
										<div className='flex items-center gap-2'>
											{showEnableFailsafe && (
												<button
													type='button'
													onClick={() => setIsEnableFailsafeOpen(true)}
													className='flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-brand/90'
												>
													<IoShieldHalf className='size-3.5' />
													{t('storage-manager.add-to-raid.enable-failsafe')}
												</button>
											)}
											<div className='hidden md:block'>
												<DriveActionButton icon={AddIcon} onClick={() => setIsInstallDrivesOpen(true)}>
													{t('storage-manager.install-drives')}
												</DriveActionButton>
											</div>
										</div>
									</div>
									{isStorageLoading ? (
										<div className='flex items-center justify-center rounded-12 bg-white/5 py-16'>
											<Spinner size='8' />
										</div>
									) : (
										drivesContent
									)}
									<div className='flex justify-center md:hidden'>
										<DriveActionButton icon={AddIcon} onClick={() => setIsInstallDrivesOpen(true)}>
											{t('storage-manager.add')}
										</DriveActionButton>
									</div>
								</div>

								{/* SSD acceleration - HDD pools only, hidden while loading for the same
								    reason as the drives section (accelerator members would render missing) */}
								{isHddPool && !isStorageLoading && (
									<AcceleratorSection
										raidType={raidType ?? 'storage'}
										acceleratorDevices={acceleratorDevices}
										candidateSsds={availableSsds}
										canReplaceFailed={canReplaceAccelerator}
										replacementCandidate={acceleratorReplacementCandidate}
										onAdd={(devices) => setAcceleratorToAdd(devices)}
										onReplaceFailed={(member) => {
											// Per-member check: with two failed members and one candidate, the
											// other member still needs a working path (physical swap instructions)
											const candidate = acceleratorCandidateFor({id: member.id, status: member.status})
											if (candidate) {
												openReplaceDialog({id: member.id, status: member.status}, candidate)
											} else {
												setSwapDeviceId(member.id)
											}
										}}
										onSwap={(member) => setSwapDeviceId(member.id)}
										onHealthClick={(device) => healthDialog.openDialog(device)}
									/>
								)}

								{/* System drive - shown for health visibility on custom hardware, never
								    usable for storage. Umbrel Pro's eMMC never appears here since only
								    NVMe/SATA devices are listed. */}
								{!isStorageLoading && systemDrives.length > 0 && (
									<div className='flex flex-col gap-2.5'>
										<div className='flex flex-col gap-1'>
											<span className='text-13 font-semibold text-white/50'>{t('storage-manager.system-drive')}</span>
											<p className='text-13 leading-snug text-white/40'>
												{t('storage-manager.system-drive.description')}
											</p>
										</div>
										{systemDrives.map((device) => (
											<SystemDriveCard
												key={device.id}
												device={device}
												onClick={() => healthDialog.openDialog(device)}
											/>
										))}
									</div>
								)}
								<UsbDrives />
								<MdadmSection />
							</div>

							{/* Right: donut chart and stats, aligned to the top of the drive column */}
							<div className='flex flex-col items-center gap-4 md:w-[240px] md:shrink-0 md:pt-6'>
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
									totalCapacityBytes={totalCapacityBytes + inactiveBytes}
									availableBytes={availableBytes}
									failsafeOverheadBytes={failsafeOverheadBytes}
									wastedBytes={wastedBytes}
									inactiveBytes={inactiveBytes}
								/>
							</div>
						</div>
					</div>
				</ImmersiveDialogContent>
			</DialogPortal>

			{/* Health dialog - no slot number outside Umbrel Pro */}
			{healthDialogDevice && (
				<SsdHealthDialog
					device={healthDialogDevice}
					open={healthDialog.open}
					onOpenChange={healthDialog.onOpenChange}
					raidDevice={
						raidDevices.find((raidDevice) => raidDevice.id === healthDialogDevice.id) ??
						acceleratorDevices.find((accelerator) => accelerator.id === healthDialogDevice.id)?.device
					}
				/>
			)}

			{/* Add single drive (Full Storage HDD pools and SSD pools) */}
			<AddToRaidDialog
				open={deviceToAdd !== null}
				onOpenChange={(open) => {
					if (!open) setDeviceToAdd(null)
				}}
				device={deviceToAdd}
				canChooseMode={!isHddPool && (canChooseMode ?? false)}
				raidType={raidType}
				raidDevices={raidDevices}
				addDeviceAsync={addDeviceAsync}
				transitionToFailsafeAsync={transitionToFailsafeAsync}
			/>

			{/* Add a mirrored pair (HDD FailSafe pools) */}
			<AddMirrorDialog
				open={mirrorToAdd !== null}
				onOpenChange={(open) => {
					if (!open) setMirrorToAdd(null)
				}}
				devices={mirrorToAdd}
				addMirrorAsync={addMirrorAsync}
			/>

			{/* Add SSD acceleration (HDD pools) */}
			<AddAcceleratorDialog
				open={acceleratorToAdd !== null}
				onOpenChange={(open) => {
					if (!open) setAcceleratorToAdd(null)
				}}
				devices={acceleratorToAdd}
				addAcceleratorAsync={addAcceleratorAsync}
			/>

			{/* Storage -> FailSafe transition (HDD pools) */}
			<EnableFailsafeDialog
				open={isEnableFailsafeOpen}
				onOpenChange={setIsEnableFailsafeOpen}
				plan={transitionPlan}
				availableBytes={availableBytes}
				transitionToFailsafeMirrorAsync={transitionToFailsafeMirrorAsync}
			/>

			{/* Replace a failed drive */}
			<ReplaceFailedDriveDialog
				raidType={raidType}
				open={replaceTarget !== null}
				onOpenChange={(open) => {
					if (!open) setReplaceTarget(null)
				}}
				newDevice={replaceTarget?.newDevice ?? null}
				failedDevice={replaceTarget?.failed ?? null}
				minRoundedDriveSize={replaceTarget?.minSize ?? 0}
				replaceDeviceAsync={replaceDeviceAsync}
			/>

			{/* Proactively swap a healthy drive (or a failed one with no replacement attached) */}
			<SwapDialog
				open={swapDeviceId !== null}
				onOpenChange={(open) => {
					if (!open) setSwapDeviceId(null)
				}}
				raidType={raidType}
				oldDeviceId={swapDeviceId}
				oldDeviceFailed={
					failedRaidDevices.some((failed) => failed.id === swapDeviceId) ||
					acceleratorDevices.some((member) => member.id === swapDeviceId && member.status !== 'ONLINE')
				}
				isUmbrelPro={false}
				raidStatus={raidStatus}
				availableDevices={swapCandidates}
				missingDeviceType={swapMemberIsAccelerator || !isHddPool ? 'ssd' : 'hdd'}
				allDevices={allDevices}
				replaceDeviceAsync={replaceDeviceAsync}
			/>

			{/* Instructions for physically installing more drives */}
			<InstallSsdDialog
				open={isInstallDrivesOpen}
				onOpenChange={setIsInstallDrivesOpen}
				isUmbrelPro={false}
				isHdd={isHddPool}
			/>
		</ImmersiveDialog>
	)
}
