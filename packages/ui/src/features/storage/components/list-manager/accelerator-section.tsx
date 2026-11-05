import {useTranslation} from 'react-i18next'
import {TbBolt, TbCircleCheckFilled} from 'react-icons/tb'

import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'

import {
	getDeviceHealth,
	RaidDevice,
	RaidDeviceStatus,
	raidStatusLabels,
	RaidType,
	StorageDevice,
} from '../../hooks/use-storage'
import {formatStorageSize, hasRaidErrors, recommendedSsdSizeLabel} from '../../utils'
import {OtherDrives} from '../other-drives'
import {DriveActionButton, ReadyToReplacePill, ReplaceIcon} from './drive-card'
import {DriveLed, SsdChip} from './drive-visuals'
import {PairCard, PairPlaceholderCell} from './mirror-pair-card'

export type AcceleratorMember = {
	id: string
	status: RaidDeviceStatus
	device?: RaidDevice
}

function getAcceleratorLed(member?: AcceleratorMember): DriveLed {
	if (!member?.device) return 'none'
	if (member.status !== 'ONLINE' || getDeviceHealth(member.device).hasWarning) return 'red'
	if (hasRaidErrors(member.device)) return 'amber'
	return 'none'
}

// Centered cell for one accelerator SSD inside a pair card
function AcceleratorCell({
	member,
	inactiveDevice,
	onClick,
	action,
}: {
	/** Accelerator member that is part of the pool */
	member?: AcceleratorMember
	/** Unpooled SSD shown as an inactive candidate */
	inactiveDevice?: StorageDevice
	onClick?: () => void
	action?: React.ReactNode
}) {
	const {t} = useTranslation()
	const device = member?.device ?? inactiveDevice
	const isFailed = member && member.status !== 'ONLINE'

	return (
		<div
			onClick={onClick}
			className={cn(
				'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-4 py-5 sm:px-10 sm:py-6',
				onClick && 'cursor-pointer transition-colors hover:bg-white/5',
			)}
		>
			{inactiveDevice && (
				<span className='absolute top-2 left-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/60'>
					{t('storage-manager.inactive')}
				</span>
			)}
			<SsdChip
				sizeLabel={device ? formatStorageSize(device.size) : '—'}
				className={cn(!device && 'opacity-40')}
				led={getAcceleratorLed(member)}
			/>
			<div className='flex w-full min-w-0 flex-col items-center gap-0.5 text-center'>
				<span className='max-w-full truncate text-[15px] font-medium text-white' title={device?.name}>
					{device ? device.name : t('storage-manager.missing-drive')}
				</span>
				{/* Missing members show their id truncated from the start so the serial stays visible */}
				<span
					dir={device ? undefined : 'rtl'}
					className='max-w-full truncate text-13 text-white/50'
					title={device ? device.serial : member?.id}
				>
					{device ? device.serial : member?.id}
				</span>
				{isFailed && member && (
					<span className='text-[12px] font-medium text-[#FF3434]'>
						{raidStatusLabels[member.status] ? t(raidStatusLabels[member.status]) : member.status}
					</span>
				)}
			</div>
			{action}
		</div>
	)
}

// Row layout for a single accelerator SSD (Full Storage mode)
function AcceleratorRow({
	device,
	subtitle,
	inactive,
	led,
	onClick,
	action,
}: {
	device: StorageDevice
	subtitle?: string
	inactive?: boolean
	led?: DriveLed
	onClick?: () => void
	action?: React.ReactNode
}) {
	const {t} = useTranslation()
	return (
		<div
			onClick={onClick}
			className={cn(
				'flex w-full items-center gap-4 rounded-12 bg-white/5 p-4',
				onClick && 'cursor-pointer transition-colors hover:bg-white/10',
			)}
		>
			<SsdChip sizeLabel={formatStorageSize(device.size)} led={led} />
			<div className='min-w-0 flex-1'>
				<div className='truncate text-[15px] font-medium text-white'>{device.name}</div>
				<div className='truncate text-13 text-white/50'>{subtitle ?? device.serial}</div>
			</div>
			{inactive && (
				<span className='rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] font-medium text-white/60'>
					{t('storage-manager.inactive')}
				</span>
			)}
			{action}
		</div>
	)
}

// Empty state inviting the user to add SSD(s), with a recommended size derived from the
// device's RAM (same guidance as onboarding)
function AcceleratorEmptyState({failsafe}: {failsafe: boolean}) {
	const {t} = useTranslation()
	const memorySizeQ = trpcReact.system.memorySize.useQuery()
	// On the rare query failure, recommend from the middle of the RAM range instead of nothing
	const sizeLabel = recommendedSsdSizeLabel(memorySizeQ.data ?? 16 * 2 ** 30)
	if (memorySizeQ.isLoading) return null
	return (
		<div className='flex w-full flex-col gap-4 rounded-12 bg-white/5 p-4 sm:flex-row sm:items-center'>
			<div className='flex shrink-0 gap-1.5 sm:flex-col'>
				{(failsafe ? [1, 2] : [1]).map((number) => (
					<SsdChip key={number} sizeLabel={sizeLabel} />
				))}
			</div>
			<div className='min-w-0 flex-1'>
				<div className='text-13 text-white/50'>
					{failsafe
						? t('storage-manager.ssd-acceleration.empty-failsafe', {size: sizeLabel})
						: t('storage-manager.ssd-acceleration.empty-storage', {size: sizeLabel})}
				</div>
				<div className='mt-0.5 text-12 text-white/40'>{t('storage-manager.ssd-acceleration.empty-hint')}</div>
			</div>
		</div>
	)
}

export function AcceleratorSection({
	raidType,
	acceleratorDevices,
	candidateSsds,
	canReplaceFailed,
	replacementCandidate,
	onAdd,
	onReplaceFailed,
	onSwap,
	onHealthClick,
}: {
	raidType: RaidType
	/** Accelerator SSDs that are part of the pool (empty when no accelerator exists) */
	acceleratorDevices: AcceleratorMember[]
	/** Unpooled SSDs that could become (or mirror) the accelerator */
	candidateSsds: StorageDevice[]
	/** Whether a failed accelerator member can currently be replaced (a candidate SSD is attached) */
	canReplaceFailed: boolean
	/** The resolved replacement for the failed member (may be a self-replacement, i.e. a pool member) */
	replacementCandidate?: StorageDevice
	onAdd: (devices: StorageDevice[]) => void
	onReplaceFailed: (member: AcceleratorMember) => void
	onSwap: (member: AcceleratorMember) => void
	onHealthClick: (device: StorageDevice) => void
}) {
	const {t} = useTranslation()
	const isFailsafe = raidType === 'failsafe'
	const acceleratorExists = acceleratorDevices.length > 0

	// Largest candidates first so we always suggest the most useful SSDs
	const candidates = [...candidateSsds].sort((a, b) => b.roundedSize - a.roundedSize)

	// Healthy members can be proactively swapped; failed members get a replace flow
	// (direct replacement when a candidate SSD is attached, swap instructions otherwise)
	const replaceAction = (member: AcceleratorMember) => {
		const isFailed = member.status !== 'ONLINE'
		if (isFailed && canReplaceFailed) {
			return (
				<DriveActionButton icon={ReplaceIcon} variant='destructive' onClick={() => onReplaceFailed(member)}>
					{t('storage-manager.replace')}
				</DriveActionButton>
			)
		}
		return (
			<DriveActionButton
				icon={ReplaceIcon}
				variant={isFailed ? 'destructive' : 'default'}
				onClick={() => onSwap(member)}
			>
				{isFailed ? t('storage-manager.replace') : t('storage-manager.swap')}
			</DriveActionButton>
		)
	}

	// When a member has failed and a fresh candidate SSD is attached, the candidate shows up
	// below the accelerator with a status pill - the Replace action lives on the failed member.
	// A self-replacement candidate is a pool member with its own row, so no pill for it.
	const unpooledCandidate =
		replacementCandidate && candidateSsds.some((ssd) => ssd.id === replacementCandidate.id)
			? replacementCandidate
			: undefined
	// Keep every unused SSD visible. The proposed FailSafe pair and any replacement
	// candidate already have their own cards and must not appear twice.
	const otherSsds = acceleratorExists
		? candidates.filter((ssd) => ssd.id !== unpooledCandidate?.id)
		: isFailsafe
			? candidates.slice(2)
			: []
	const setupDescription = isFailsafe
		? candidates.length === 1
			? t('storage-manager.ssd-acceleration.needs-pair')
			: t('storage-manager.ssd-acceleration.ready-pair')
		: t('storage-manager.ssd-acceleration.choose-ssd')

	let content: React.ReactNode
	if (acceleratorExists && !isFailsafe) {
		// Single accelerator SSD
		const member = acceleratorDevices[0]
		content = member.device ? (
			<AcceleratorRow
				device={member.device}
				led={getAcceleratorLed(member)}
				onClick={() => onHealthClick(member.device!)}
				action={replaceAction(member)}
			/>
		) : (
			<div className='flex w-full items-center gap-4 rounded-12 border border-[#FF3434]/40 bg-[#FF3434]/10 p-4'>
				<SsdChip sizeLabel='—' className='opacity-40' />
				<div className='min-w-0 flex-1'>
					<div className='truncate text-[15px] font-medium text-white'>{t('storage-manager.missing-drive')}</div>
					<div className='truncate text-13 text-white/50'>{member.id}</div>
				</div>
				{replaceAction(member)}
			</div>
		)
	} else if (acceleratorExists && isFailsafe) {
		// Mirrored accelerator pair
		const [left, right] = acceleratorDevices
		const anyFailed = acceleratorDevices.some((member) => member.status !== 'ONLINE' || !member.device)
		content = (
			<PairCard
				badge={anyFailed ? 'broken' : 'protected'}
				left={
					<AcceleratorCell
						member={left}
						onClick={left?.device ? () => onHealthClick(left.device!) : undefined}
						action={left && replaceAction(left)}
					/>
				}
				right={
					right ? (
						<AcceleratorCell
							member={right}
							onClick={right.device ? () => onHealthClick(right.device!) : undefined}
							action={replaceAction(right)}
						/>
					) : (
						/* No size to suggest when the surviving member's physical device is detached */
						<PairPlaceholderCell
							title={
								left?.device
									? t('storage-manager.ssd-acceleration.pair-placeholder', {size: formatStorageSize(left.device.size)})
									: t('storage-manager.ssd-acceleration.pair-placeholder-no-size')
							}
							description={t('storage-manager.ssd-acceleration.pair-note')}
						/>
					)
				}
			/>
		)
	} else if (!isFailsafe) {
		// No accelerator yet, storage mode: one SSD can be added directly
		content =
			candidates.length === 0 ? (
				<AcceleratorEmptyState failsafe={false} />
			) : (
				<div className='flex flex-col gap-3'>
					{candidates.map((ssd) => (
						<AcceleratorRow
							key={ssd.id}
							device={ssd}
							inactive
							onClick={() => onHealthClick(ssd)}
							action={
								<DriveActionButton icon={TbBolt} variant='primary' onClick={() => onAdd([ssd])}>
									{t('storage-manager.ssd-acceleration.enable')}
								</DriveActionButton>
							}
						/>
					))}
				</div>
			)
	} else {
		// No accelerator yet, failsafe mode: needs two SSDs added together
		if (candidates.length === 0) {
			content = <AcceleratorEmptyState failsafe />
		} else if (candidates.length === 1) {
			const ssd = candidates[0]
			content = (
				<PairCard
					broken
					badge='broken'
					left={<AcceleratorCell inactiveDevice={ssd} onClick={() => onHealthClick(ssd)} />}
					right={
						<PairPlaceholderCell
							title={t('storage-manager.ssd-acceleration.pair-placeholder', {size: formatStorageSize(ssd.size)})}
							description={t('storage-manager.ssd-acceleration.pair-note')}
						/>
					}
				/>
			)
		} else {
			const [first, second] = candidates
			content = (
				<div className='flex flex-col items-center gap-3'>
					<PairCard
						badge='add'
						left={<AcceleratorCell inactiveDevice={first} onClick={() => onHealthClick(first)} />}
						right={<AcceleratorCell inactiveDevice={second} onClick={() => onHealthClick(second)} />}
					/>
					<DriveActionButton icon={TbBolt} variant='primary' onClick={() => onAdd([first, second])}>
						{t('storage-manager.ssd-acceleration.enable')}
					</DriveActionButton>
				</div>
			)
		}
	}

	return (
		<div className='flex flex-col gap-2.5'>
			<div className='flex flex-col gap-1'>
				<span className='flex items-center gap-1.5 text-13 font-semibold text-white/50'>
					{t('storage-manager.ssd-acceleration')}
					{acceleratorExists && <TbCircleCheckFilled className='size-4 text-brand' />}
				</span>
				<p className='text-13 leading-snug text-white/40'>{t('storage-manager.ssd-acceleration.description')}</p>
				{!acceleratorExists && candidates.length > 0 && (
					<p className='text-13 leading-relaxed text-white/50'>{setupDescription}</p>
				)}
			</div>
			{content}
			{unpooledCandidate && (
				<div className='flex flex-col gap-1'>
					<AcceleratorRow
						device={unpooledCandidate}
						onClick={() => onHealthClick(unpooledCandidate)}
						action={<ReadyToReplacePill />}
					/>
					<p className='text-13 leading-relaxed text-white/50'>{t('storage-manager.ready-to-replace-description')}</p>
				</div>
			)}
			<OtherDrives
				drives={otherSsds}
				description={
					<p>
						{acceleratorExists
							? t('storage-manager.other-drives.acceleration-enabled')
							: t('storage-manager.other-drives.acceleration-pair-selected')}
					</p>
				}
				onHealthClick={onHealthClick}
			/>
		</div>
	)
}
