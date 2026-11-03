// HDD RAID onboarding flow - kept intentionally large because it's a cohesive page flow
// (results -> FailSafe pairing -> optional SSD acceleration), rendered inside the design's
// onboarding modal card. Registration and the reboot-spanning progress UI live in setup.tsx.

import {LayoutGroup, motion, useReducedMotion} from 'motion/react'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {
	TbAlertCircleFilled,
	TbCircleCheckFilled,
	TbDeviceFloppy,
	TbLoader,
	TbServer,
	TbShield,
	TbShieldOff,
} from 'react-icons/tb'
import {useLocation, useNavigate} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Spinner} from '@/components/ui/loading'
import {HardDriveIcon, SsdChip} from '@/features/storage/components/list-manager/drive-visuals'
import {SsdCard} from '@/features/storage/components/ssd-card'
import {recommendedSsdSizeLabel} from '@/features/storage/utils'
import {primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {RecommendedBadge} from '@/routes/onboarding/recommended-badge'
import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

import {RaidError} from '../raid/raid-error'
import {formatSize, StorageDevice, useDetectStorageDevices} from '../raid/use-raid-setup'
import {FoundDeviceCard, ModalShell, StepHeader} from './components'
import {HddRecoverExistingInstall} from './recover-existing-install'
import {getCandidates, HddRaidSetupConfig, planAcceleratorPair, planFailsafePairs} from './use-hdd-raid-onboarding'

type Step = 'results' | 'failsafe' | 'accelerate'

// Format bytes, but if 0, use the same unit as the reference value (e.g., "0TB" instead of "0B")
const formatSizeWithUnit = (bytes: number, referenceBytes: number) => {
	if (bytes === 0 && referenceBytes > 0) {
		const unit = formatSize(referenceBytes).replace(/[^A-Za-z]/g, '') // "1,5TB" → "TB"
		return `0${unit}`
	}
	return formatSize(bytes)
}

// ============================================================================
// Sub-components
// ============================================================================

// Shared timing for the mode-switch layout animation: a spring with barely-there
// bounce so drives glide between pair and per-drive arrangements without feeling toy-like
const layoutSpring = {type: 'spring', duration: 0.45, bounce: 0.15} as const

// Drive rendering inside a FailSafe column cell. The layoutId lets the same physical
// drive fly to its new column when the storage mode changes (a transform-only FLIP
// animation, so it stays cheap), instead of teleporting.
function ColumnDrive({device, subtitle}: {device: StorageDevice; subtitle: string}) {
	const reduceMotion = useReducedMotion()
	return (
		<motion.div
			layoutId={reduceMotion ? undefined : `hdd-${device.id ?? device.serial}`}
			transition={layoutSpring}
			className='flex w-full flex-col items-center gap-2.5'
		>
			<HardDriveIcon led='green' />
			<div className='flex w-full flex-col items-center gap-0.5 text-center'>
				<span className='max-w-full truncate text-[15px] font-medium text-white'>{device.name}</span>
				<span className='max-w-full truncate text-13 text-white/40'>{subtitle}</span>
			</div>
		</motion.div>
	)
}

// Pill sitting on the divider between the two halves of a column
function DividerPill({tone, children}: {tone: 'brand' | 'red'; children: React.ReactNode}) {
	return (
		<span
			className={cn(
				'absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-white shadow-md',
				tone === 'brand' ? 'bg-brand' : 'bg-[#FF3434]',
			)}
		>
			{children}
		</span>
	)
}

// A vertical column in the FailSafe visualization: header slot above, card with a top
// and bottom half separated by a divider carrying a pill/icon. `ratio` matches the
// designs: even halves for pairs, a taller top half in the per-drive (FailSafe off) view.
function Column({
	header,
	top,
	bottom,
	divider,
	broken,
	ratio = 'even',
	width = 'normal',
}: {
	header?: React.ReactNode
	top: React.ReactNode
	bottom: React.ReactNode
	divider?: React.ReactNode
	broken?: boolean
	ratio?: 'even' | 'storage-heavy'
	width?: 'normal' | 'narrow'
}) {
	// The whole column participates in the mode-switch layout animation: the column
	// itself glides to its new position, the two halves resize as the ratio changes,
	// and their content re-centers via position-only layout so text never stretches.
	// Reduced motion disables the layout animation entirely - states just swap.
	const reduceMotion = useReducedMotion()
	const layoutBox = reduceMotion ? false : true
	const layoutPosition = reduceMotion ? false : ('position' as const)
	return (
		<motion.div
			layout={layoutBox}
			transition={layoutSpring}
			className={cn('flex shrink-0 flex-col gap-2.5', width === 'narrow' ? 'w-[130px]' : 'w-[200px]')}
		>
			<motion.div
				layout={layoutPosition}
				transition={layoutSpring}
				className='flex h-[22px] items-center justify-center gap-1.5'
			>
				{header}
			</motion.div>
			<motion.div
				layout={layoutBox}
				transition={layoutSpring}
				className={cn(
					'flex flex-1 flex-col overflow-hidden rounded-2xl border',
					broken ? 'border-dashed border-[#FF3434]/60 bg-[#FF3434]/5' : 'border-white/6 bg-white/4',
				)}
			>
				<motion.div
					layout={layoutBox}
					transition={layoutSpring}
					className={cn(
						'flex flex-col items-center justify-center px-4 py-6',
						ratio === 'storage-heavy' ? 'flex-[3]' : 'flex-1',
					)}
				>
					<motion.div
						layout={layoutPosition}
						transition={layoutSpring}
						className='flex w-full flex-col items-center gap-2.5'
					>
						{top}
					</motion.div>
				</motion.div>
				<motion.div
					layout={layoutBox}
					transition={layoutSpring}
					className={cn('relative w-full', broken ? 'border-t border-dashed border-[#FF3434]/40' : 'h-px bg-white/8')}
				>
					{divider}
				</motion.div>
				<motion.div
					layout={layoutBox}
					transition={layoutSpring}
					className={cn(
						'flex flex-col items-center justify-center px-4 py-6 text-center',
						ratio === 'storage-heavy' ? 'flex-[2]' : 'flex-1',
						broken && 'bg-[#3C1C1C]/30',
					)}
				>
					<motion.div
						layout={layoutPosition}
						transition={layoutSpring}
						className='flex w-full flex-col items-center gap-1.5 text-center'
					>
						{bottom}
					</motion.div>
				</motion.div>
			</motion.div>
		</motion.div>
	)
}

// Note about accelerator SSDs being permanent. Muted rather than amber, matching the
// informational (not warning) treatment the Pro and SSD RAID screens use.
function PermanentWarning({single}: {single?: boolean}) {
	const {t} = useTranslation()
	return (
		<p className='mx-auto text-[13px] text-white/50'>
			{single
				? t('onboarding.hdd-raid.accelerate.permanent-warning-single')
				: t('onboarding.hdd-raid.accelerate.permanent-warning')}
		</p>
	)
}

// One selectable storage mode - the interactive twin of the storage manager's
// read-only StorageModeDisplay cards, sharing its copy and visual language
function ModeCard({
	icon,
	title,
	description,
	selected,
	disabledReason,
	badge,
	onSelect,
}: {
	icon: React.ReactNode
	title: string
	description: string
	selected: boolean
	/** When set, the card is unavailable: it stays fully legible and this short reason shows in place of the checkmark */
	disabledReason?: string
	badge?: React.ReactNode
	onSelect: () => void
}) {
	const disabled = disabledReason !== undefined
	return (
		<button
			type='button'
			onClick={onSelect}
			disabled={disabled}
			className={cn(
				'flex flex-col gap-2 rounded-17 border px-4 py-3 text-left transition-colors',
				selected ? 'border-brand bg-brand/15' : 'border-transparent',
				!selected && !disabled && 'hover:bg-white/4',
			)}
		>
			<div className='flex w-full items-center gap-2'>
				<span className={selected ? 'text-white' : 'text-white/80'}>{icon}</span>
				<span className={cn('text-15 font-semibold', selected ? 'text-white' : 'text-white/80')}>{title}</span>
				<span className='ml-auto flex items-center gap-2'>
					{badge}
					{selected && <TbCircleCheckFilled className='size-5 text-brand' />}
					{disabled && (
						<span className='rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-white/50'>
							{disabledReason}
						</span>
					)}
				</span>
			</div>
			<p className='text-13 leading-snug font-medium text-white/60'>{description}</p>
		</button>
	)
}

// Empty state when there are no (or not enough) SSDs: an invitation to add one, with
// a recommended size derived from the device's RAM
function NoSsdCard({pair, onPowerOff}: {pair: boolean; onPowerOff: () => void}) {
	const {t} = useTranslation()
	const memorySizeQ = trpcReact.system.memorySize.useQuery()
	// On the rare query failure, recommend from the middle of the RAM range instead of nothing
	const sizeLabel = recommendedSsdSizeLabel(memorySizeQ.data ?? 16 * 2 ** 30)
	if (memorySizeQ.isLoading) return null
	return (
		<div className='flex flex-col items-center gap-1.5 rounded-2xl bg-white/4 px-6 py-14 text-center'>
			<div className='mb-3 flex gap-2'>
				{(pair ? [1, 2] : [1]).map((number) => (
					<SsdChip key={number} sizeLabel={sizeLabel} className='h-12 w-20' />
				))}
			</div>
			<span className='max-w-[560px] text-[15px] font-medium text-white'>
				{pair
					? t('onboarding.hdd-raid.accelerate.none-title-pair', {size: sizeLabel})
					: t('onboarding.hdd-raid.accelerate.none-title-single', {size: sizeLabel})}
			</span>
			<span className='max-w-[560px] text-[12px] leading-relaxed text-white/40'>
				{t('onboarding.hdd-raid.accelerate.none-hint')}
			</span>
			<span className='mt-2 max-w-[560px] text-[12px] leading-relaxed text-white/40'>
				{t('onboarding.hdd-raid.accelerate.none-hint-later')}
			</span>
			<button
				type='button'
				onClick={onPowerOff}
				className='mt-4 rounded-full bg-white/10 px-4 py-1.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/15'
			>
				{t('onboarding.hdd-raid.accelerate.power-off')}
			</button>
		</div>
	)
}

// ============================================================================
// Main flow
// ============================================================================

export default function HddRaidOnboarding() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	// Credentials passed from create-account via location.state (same pattern as the Pro
	// RAID flow: survives refresh, lost on direct URL navigation - then we redirect back)
	const credentials = location.state?.credentials as AccountCredentials | undefined

	const {devices, isDetecting, isFetching, error, refetch} = useDetectStorageDevices()
	// A pre-existing umbrelOS RAID install on the attached drives gets a restore-or-erase
	// choice before we offer a fresh setup (same flow as Pro onboarding)
	const recoverableInstallQ = trpcReact.hardware.raid.hasRecoverableInstall.useQuery(undefined, {
		enabled: !!credentials,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: Infinity,
	})
	const [setUpAsNew, setSetUpAsNew] = useState(false)
	const [pendingConfig, setPendingConfig] = useState<HddRaidSetupConfig | null>(null)
	const [step, setStep] = useState<Step>('results')
	// True while an explicit "Scan again" is in flight (the background poll doesn't set this)
	const [isRescanning, setIsRescanning] = useState(false)
	// null = derive the default from the detected drives; set once the user toggles
	const [failSafeChoice, setFailSafeChoice] = useState<boolean | null>(null)
	// null = derive the default (largest SSD); set once the user changes the selection
	const [ssdChoice, setSsdChoice] = useState<string[] | null>(null)
	const {shutdown} = useGlobalSystemState()

	// Redirect to create-account if credentials are missing
	useEffect(() => {
		if (!credentials) navigate('/onboarding/create-account', {replace: true})
	}, [credentials, navigate])

	// --- Derived state ---

	const {hdds, ssds} = getCandidates(devices)
	const {pairs, unpaired} = planFailsafePairs(hdds)
	const canEnableFailSafe = pairs.length >= 1
	// Recommended (and default on) when every drive can be paired
	const failSafeRecommended = canEnableFailSafe && unpaired.length === 0
	const failSafeEnabled = canEnableFailSafe && (failSafeChoice ?? failSafeRecommended)

	const totalDetectedBytes = [...hdds, ...ssds].reduce((sum, device) => sum + device.roundedSize, 0)
	const totalHddBytes = hdds.reduce((sum, device) => sum + device.roundedSize, 0)
	// Mirrors store one drive's worth of data per pair
	const pairBytes = pairs.reduce((sum, [drive]) => sum + drive.roundedSize, 0)
	const availableBytes = failSafeEnabled ? pairBytes : totalHddBytes
	const failsafeBytes = failSafeEnabled ? pairBytes : 0
	const inactiveBytes = failSafeEnabled ? unpaired.reduce((sum, device) => sum + device.roundedSize, 0) : 0

	// Accelerator candidates: FailSafe needs a mirrored pair of same-size SSDs,
	// Full Storage takes a single SSD (largest selected by default)
	const acceleratorPair = planAcceleratorPair(ssds)
	const largestSsd = [...ssds].sort((a, b) => b.roundedSize - a.roundedSize)[0]
	const selectedSsdIds = failSafeEnabled
		? acceleratorPair
			? [acceleratorPair[0].id!, acceleratorPair[1].id!]
			: []
		: (ssdChoice ?? (largestSsd ? [largestSsd.id!] : []))
	const hasSelection = selectedSsdIds.length > 0

	if (!credentials) return null

	// Keep recovery mounted through inventory failures during its expected reboot.
	// "Set up as new" requires an explicit erase confirmation inside the recovery screen.
	if (recoverableInstallQ.data === true && !setUpAsNew) {
		return <HddRecoverExistingInstall devices={[...hdds, ...ssds]} onSetUpAsNew={() => setSetUpAsNew(true)} />
	}

	if (isDetecting || recoverableInstallQ.isLoading) {
		return (
			<div className='flex flex-1 flex-col items-center justify-center gap-4'>
				{/* Same spinner as the Files listing loading state */}
				<TbLoader className='white h-6 w-6 animate-spin opacity-50 shadow-xs' />
				<span className='text-[15px] text-white/85'>{t('onboarding.hdd-raid.scanning')}</span>
			</div>
		)
	}

	if (error || recoverableInstallQ.isError) {
		return (
			<RaidError
				title={t('onboarding.raid.error.detection-failed')}
				instructions={t('storage-status.check-failed')}
				detail={error ?? recoverableInstallQ.error?.message}
				onRetry={() => {
					void refetch()
					void recoverableInstallQ.refetch()
				}}
				retrying={isFetching || recoverableInstallQ.isFetching}
			/>
		)
	}

	// --- Actions ---

	// Rescan with a brief minimum spinner so the click visibly registers even when
	// the query returns instantly with no changes
	const handleScanAgain = async () => {
		setIsRescanning(true)
		try {
			await Promise.all([refetch(), sleep(600)])
		} finally {
			setIsRescanning(false)
		}
	}

	const handleFinish = (withAccelerator: boolean) => {
		const raidDevices = failSafeEnabled ? pairs.flatMap(([a, b]) => [a.id!, b.id!]) : hdds.map((device) => device.id!)
		const acceleratorDevices = withAccelerator && hasSelection ? selectedSsdIds : undefined
		const config: HddRaidSetupConfig = {
			raidDevices,
			raidType: failSafeEnabled ? 'failsafe' : 'storage',
			acceleratorDevices,
		}
		setPendingConfig(config)
	}

	const eraseConfirmationDialog = (
		<AlertDialog open={!!pendingConfig} onOpenChange={(open) => !open && setPendingConfig(null)}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('onboarding.raid.recovery.set-up-new-dialog.title')}</AlertDialogTitle>
					<AlertDialogDescription>
						{(pendingConfig?.raidDevices.length ?? 0) + (pendingConfig?.acceleratorDevices?.length ?? 0) > 1
							? t('storage-manager.add-drives-erase-warning')
							: t('storage-manager.add-drive-erase-warning')}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						onClick={() => {
							if (!pendingConfig) return
							navigate('/onboarding/hdd-raid/setup', {state: {credentials, config: pendingConfig}})
						}}
					>
						{t('onboarding.raid.recovery.set-up-new-dialog.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)

	// --- Footer stats shared by the FailSafe and accelerate steps ---

	const storageStats = (
		<div className='flex flex-col gap-0.5'>
			<span className='text-[17px] font-semibold text-white/85'>
				{t('onboarding.raid.available-storage')} <span className='text-brand'>{formatSize(availableBytes)}</span>
			</span>
			<span className='text-13 text-white/50'>
				{t('onboarding.raid.failsafe')}{' '}
				<span className='font-medium text-white/85'>{formatSizeWithUnit(failsafeBytes, availableBytes)}</span>
				{inactiveBytes > 0 && (
					<>
						{' · '}
						{t('storage-manager.inactive')} <span className='text-[#FF3434]'>{formatSize(inactiveBytes)}</span>
					</>
				)}
			</span>
		</div>
	)

	// --- Step: detected storage results ---

	if (step === 'results') {
		const hasDetectedDrives = hdds.length > 0 || ssds.length > 0
		return (
			<ModalShell
				key={step}
				footer={
					<>
						{/* Empty span keeps the justify-between footer's actions on the right */}
						{hasDetectedDrives ? (
							<span className='text-[17px] font-semibold text-white/85'>
								{t('onboarding.hdd-raid.total-detected')}{' '}
								<span className='text-brand'>{formatSize(totalDetectedBytes)}</span>
							</span>
						) : (
							<span />
						)}
						<div className='flex flex-wrap items-center gap-3'>
							<button className={secondaryButtonClasss} disabled={isRescanning} onClick={handleScanAgain}>
								<span className='flex items-center gap-1.5'>
									{isRescanning && <Spinner />}
									{t('onboarding.hdd-raid.scan-again')}
								</span>
							</button>
							<button {...primaryButtonProps} disabled={hdds.length === 0} onClick={() => setStep('failsafe')}>
								{t('onboarding.raid.continue')}
							</button>
						</div>
					</>
				}
			>
				<StepHeader
					title={t('onboarding.raid.storage')}
					subTitle={hasDetectedDrives ? t('onboarding.hdd-raid.devices-found') : undefined}
				/>
				{hdds.length === 0 && ssds.length === 0 ? (
					<div className='flex flex-col items-center gap-1 rounded-2xl bg-white/4 px-6 py-14 text-center'>
						<span className='text-[15px] font-medium text-white'>{t('onboarding.hdd-raid.no-drives')}</span>
						<span className='text-13 text-white/40'>{t('onboarding.hdd-raid.no-drives-instructions')}</span>
					</div>
				) : (
					<div className='grid gap-3 md:grid-cols-2'>
						{[...hdds, ...ssds].map((device) => (
							<FoundDeviceCard key={device.id} device={device} />
						))}
					</div>
				)}
			</ModalShell>
		)
	}

	// --- Step: FailSafe pairing ---

	if (step === 'failsafe') {
		const ratio = failSafeEnabled ? 'even' : 'storage-heavy'
		return (
			<ModalShell
				key={step}
				footer={
					<>
						{storageStats}
						<div className='flex flex-wrap items-center gap-3'>
							<button className={secondaryButtonClasss} onClick={() => setStep('results')}>
								{t('back')}
							</button>
							<button {...primaryButtonProps} onClick={() => setStep('accelerate')}>
								{failSafeEnabled ? t('onboarding.raid.continue') : t('onboarding.hdd-raid.continue-without-failsafe')}
							</button>
						</div>
					</>
				}
			>
				<StepHeader title={t('onboarding.hdd-raid.mode.title')} subTitle={t('onboarding.hdd-raid.mode.subtitle')} />

				{/* Mode choice - same cards as the storage manager's mode display, made selectable */}
				<div className='grid gap-2 rounded-24 bg-white/5 p-2 md:grid-cols-2'>
					<ModeCard
						icon={<TbServer className='size-5' />}
						title={t('storage-manager.mode.full-storage')}
						description={t('storage-manager.mode.full-storage.description-drive')}
						selected={!failSafeEnabled}
						onSelect={() => setFailSafeChoice(false)}
					/>
					<ModeCard
						icon={<IoShieldHalf className='size-5' />}
						title={t('storage-manager.mode.failsafe')}
						description={t('storage-manager.mode.failsafe.description-drive')}
						selected={failSafeEnabled}
						disabledReason={canEnableFailSafe ? undefined : t('onboarding.hdd-raid.mode.failsafe-unavailable')}
						badge={failSafeRecommended ? <RecommendedBadge small className='hidden md:flex' /> : undefined}
						onSelect={() => setFailSafeChoice(true)}
					/>
				</div>

				{/* Columns: legend + one column per pair (on) or per drive (off). LayoutGroup
				    coordinates the drive cards flying between arrangements on mode change. */}
				<div className='overflow-x-auto pb-1'>
					<LayoutGroup>
						<div className='mx-auto flex w-max min-w-full justify-center gap-3 md:min-h-[400px]'>
							{/* Legend column */}
							<Column
								width='narrow'
								ratio={ratio}
								top={
									<>
										<TbDeviceFloppy className='size-5 text-white/80' />
										<span className='text-center text-[15px] font-medium text-white/85'>
											{t('onboarding.hdd-raid.failsafe.usable-storage')}
										</span>
										<span className='text-13 text-white/40'>{formatSize(availableBytes)}</span>
									</>
								}
								bottom={
									<>
										<TbShield className='size-5 text-white/80' />
										<span className='text-[15px] font-medium text-white/85'>{t('onboarding.raid.failsafe')}</span>
										<span className='text-13 text-white/40'>{formatSizeWithUnit(failsafeBytes, availableBytes)}</span>
									</>
								}
							/>

							{failSafeEnabled ? (
								<>
									{pairs.map(([top, bottom]) => (
										<Column
											key={top.id}
											header={
												<>
													<TbCircleCheckFilled className='size-4 text-brand' />
													<span className='text-[15px] font-semibold text-white/90'>{formatSize(top.roundedSize)}</span>
												</>
											}
											top={<ColumnDrive device={top} subtitle={top.serial} />}
											bottom={<ColumnDrive device={bottom} subtitle={bottom.serial} />}
											divider={
												<DividerPill tone='brand'>
													<IoShieldHalf className='size-3' />
													{t('onboarding.hdd-raid.failsafe.pair-pill')}
												</DividerPill>
											}
										/>
									))}
									{unpaired.map((device) => (
										<Column
											key={device.id}
											broken
											header={
												<>
													<TbAlertCircleFilled className='size-4 text-[#FF3434]' />
													<span className='text-[15px] font-semibold text-white/90'>
														{formatSize(device.roundedSize)}
													</span>
												</>
											}
											top={<ColumnDrive device={device} subtitle={device.serial} />}
											bottom={
												<>
													<span className='text-[15px] font-medium text-white'>
														{t('storage-manager.pair-placeholder', {size: formatSize(device.roundedSize)})}
													</span>
													<span className='text-[12px] leading-snug text-white/40'>
														{t('onboarding.hdd-raid.failsafe.above-inactive')}
													</span>
												</>
											}
											divider={
												<DividerPill tone='red'>
													<TbShieldOff className='size-3' />
													{t('onboarding.hdd-raid.failsafe.no-pair-available')}
												</DividerPill>
											}
										/>
									))}
								</>
							) : (
								hdds.map((device) => (
									<Column
										key={device.id}
										ratio='storage-heavy'
										top={
											<ColumnDrive device={device} subtitle={`${formatSize(device.roundedSize)} · ${device.serial}`} />
										}
										bottom={<span className='text-[15px] text-white/40'>{t('onboarding.hdd-raid.failsafe.none')}</span>}
										divider={
											<span className='absolute top-1/2 left-1/2 z-10 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#39393B]'>
												<TbShieldOff className='size-3.5 text-white/60' />
											</span>
										}
									/>
								))
							)}
						</div>
					</LayoutGroup>
				</div>
			</ModalShell>
		)
	}

	// --- Step: SSD acceleration (optional) ---

	return (
		<ModalShell
			key={step}
			footer={
				<>
					{storageStats}
					<div className='flex flex-wrap items-center gap-3'>
						<button className={secondaryButtonClasss} onClick={() => setStep('failsafe')}>
							{t('back')}
						</button>
						{failSafeEnabled ? (
							acceleratorPair ? (
								<>
									<button className={secondaryButtonClasss} onClick={() => handleFinish(false)}>
										{t('onboarding.hdd-raid.accelerate.continue-without')}
									</button>
									<button {...primaryButtonProps} onClick={() => handleFinish(true)}>
										{t('onboarding.raid.continue')}
									</button>
								</>
							) : (
								// FailSafe accelerators come in pairs, hence the plural
								<button {...primaryButtonProps} onClick={() => handleFinish(false)}>
									{t('onboarding.hdd-raid.accelerate.continue-without-ssds')}
								</button>
							)
						) : (
							<button {...primaryButtonProps} onClick={() => handleFinish(hasSelection)}>
								{ssds.length === 0
									? t('onboarding.hdd-raid.accelerate.continue-without-ssd')
									: t('onboarding.hdd-raid.finish')}
							</button>
						)}
					</div>
				</>
			}
		>
			<StepHeader
				title={t('onboarding.hdd-raid.accelerate.title')}
				titleExtra={<span className='text-white/40'>({t('onboarding.hdd-raid.accelerate.optional')})</span>}
				subTitle={
					failSafeEnabled
						? t('onboarding.hdd-raid.accelerate.description')
						: t('onboarding.hdd-raid.accelerate.description-single')
				}
			/>
			<div className='border-t border-white/8' />

			{failSafeEnabled ? (
				// FailSafe: the accelerator must be a mirrored pair of same-size SSDs
				acceleratorPair ? (
					// Vertically centered in the step's free space
					<div className='flex flex-1 flex-col justify-center gap-4'>
						{/* The same SSD cards as the SSD RAID flow */}
						<div className='mx-auto flex w-full max-w-[400px] flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-2.5'>
							{acceleratorPair.map((device) => (
								<SsdCard
									key={device.id}
									size={formatSize(device.roundedSize)}
									model={`${device.name} · ${device.serial}`}
								/>
							))}
						</div>
						<PermanentWarning />
					</div>
				) : ssds.length > 0 ? (
					<div className='mx-auto w-full max-w-[400px] rounded-2xl border border-dashed border-[#FF3434]/60 bg-[#FF3434]/5 p-2.5'>
						<SsdCard
							size={formatSize(largestSsd.roundedSize)}
							model={`${largestSsd.name} · ${largestSsd.serial}`}
							variant='neutral'
						/>
						<div className='relative my-2.5 w-full border-t border-dashed border-[#FF3434]/40'>
							<DividerPill tone='red'>
								<TbShieldOff className='size-3' />
								{t('onboarding.hdd-raid.accelerate.no-pair-title')}
							</DividerPill>
						</div>
						<div className='flex flex-col items-center gap-1.5 rounded-xl bg-[#3C1C1C]/30 px-6 py-10 text-center'>
							<span className='text-[15px] font-medium text-white'>
								{t('onboarding.hdd-raid.accelerate.add-matching-ssd')}
							</span>
							<span className='text-[12px] leading-relaxed text-white/40'>
								{t('onboarding.hdd-raid.accelerate.no-pair-note-mirrored')}
								<br />
								{t('onboarding.hdd-raid.accelerate.no-pair-note-larger')}
							</span>
						</div>
					</div>
				) : (
					<NoSsdCard pair onPowerOff={() => shutdown()} />
				)
			) : // Full Storage: a single SSD accelerates the pool
			ssds.length > 0 ? (
				// Vertically centered in the step's free space
				<div className='flex flex-1 flex-col justify-center gap-4'>
					<p className='text-center text-[14px] text-white/85'>{t('onboarding.hdd-raid.accelerate.select-single')}</p>
					{/* Selection via the SSD RAID flow's cards: the brand plate tint marks the chosen SSD */}
					{ssds.map((device) => {
						const selected = selectedSsdIds.includes(device.id!)
						return (
							<button
								key={device.id}
								type='button'
								onClick={() => setSsdChoice(selected ? [] : [device.id!])}
								className={cn(
									'mx-auto w-full max-w-[400px] rounded-xl text-left transition-opacity',
									!selected && 'opacity-80 hover:opacity-100',
								)}
							>
								<SsdCard
									size={formatSize(device.roundedSize)}
									model={`${device.name} · ${device.serial}`}
									variant={selected ? 'storage' : 'neutral'}
									trailing={selected ? <TbCircleCheckFilled className='mr-1.5 size-6 text-brand' /> : undefined}
								/>
							</button>
						)
					})}
					{hasSelection && <PermanentWarning single />}
				</div>
			) : (
				<NoSsdCard pair={false} onPowerOff={() => shutdown()} />
			)}
			{eraseConfirmationDialog}
		</ModalShell>
	)
}
