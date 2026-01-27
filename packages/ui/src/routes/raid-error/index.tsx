import {useState} from 'react'
import {Trans} from 'react-i18next/TransWithoutContext'
import {TbActivityHeartbeat, TbAlertTriangle, TbAlertTriangleFilled, TbCircleCheckFilled} from 'react-icons/tb'
import {Navigate} from 'react-router-dom'

import {BareCoverMessage} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {OnboardingPage} from '@/layouts/bare/onboarding-page'
import {useGlobalSystemState} from '@/providers/global-system-state'
import {SsdHealthDialog, useSsdHealthDialog} from '@/routes/onboarding/raid/ssd-health-dialog'
import {SsdSlot, SsdTray} from '@/routes/onboarding/raid/ssd-tray'
import {formatSize, getDeviceHealth, useDetectStorageDevices} from '@/routes/onboarding/raid/use-raid-setup'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

const Highlight = ({children}: {children?: React.ReactNode}) => <span className='text-white'>{children}</span>

// TODO: Remove mocks before merging
const USE_MOCK = false
const MOCK_RAID_DEVICES = [
	{name: 'nvme0n1', isOk: true},
	{name: 'nvme1n1', isOk: false},
]

function TroubleshootingStep({
	number,
	title,
	description,
	buttonText,
	onClick,
	disabled,
}: {
	number: number
	title: string
	description: string
	buttonText: string
	onClick: () => void
	disabled?: boolean
}) {
	return (
		<div className='flex items-center gap-3 p-3'>
			<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
				{number}
			</span>
			<div className='flex flex-1 flex-col gap-0.5'>
				<span className='text-12 font-semibold text-white'>{title}</span>
				<span className='text-12 text-white/50'>{description}</span>
			</div>
			<Button size='sm' variant='default' onClick={onClick} disabled={disabled} className='h-7 px-3 text-11'>
				{buttonText}
			</Button>
		</div>
	)
}

export default function RaidErrorScreen() {
	// Dialog states
	const [showShutdownDialog, setShowShutdownDialog] = useState(false)
	const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false)

	// Check if there's actually a RAID mount failure - we redirect away if not
	const mountFailureQ = trpcReact.hardware.raid.checkRaidMountFailure.useQuery(undefined, {
		retry: false,
	})

	// Get RAID status for each device (which drives were in RAID and their status)
	const raidDevicesQ = trpcReact.hardware.raid.checkRaidMountFailureDevices.useQuery()

	// Get detailed device info (for drives that ARE detected)
	const {devices: availableDevices} = useDetectStorageDevices()

	// SSD Health dialog state
	const healthDialog = useSsdHealthDialog()

	// System actions - we use global state here for proper overlay covers
	const {restart, shutdown} = useGlobalSystemState()

	// In recovery mode (RAID mount failure), factory reset doesn't require a password
	// We call the mutation directly - global state will show ResettingCover based on status
	const factoryResetMut = trpcReact.system.factoryReset.useMutation({
		onError: (error) => {
			toast.error(t('raid-error.factory-reset-failed'), {
				description: error.message,
			})
		},
	})

	// If no mount failure, we redirect to home
	if (mountFailureQ.isLoading) {
		return (
			<BareCoverMessage>
				<Loading />
			</BareCoverMessage>
		)
	}

	if (mountFailureQ.data === false || mountFailureQ.isError) {
		return <Navigate to='/' replace />
	}

	const raidDevices = USE_MOCK ? MOCK_RAID_DEVICES : raidDevicesQ.data

	// Build list of DETECTED drives only (with accurate slot info)
	// Filter out any drives without a known slot number
	const detectedDrives = availableDevices
		.filter((device) => device.slot !== undefined)
		.map((device) => {
			const hasHealthWarning = getDeviceHealth(device).hasWarning
			return {
				slotNum: device.slot as number,
				device,
				hasHealthWarning,
			}
		})

	// Count missing RAID drives (configured but not detected)
	const missingDriveCount = raidDevices?.filter((rd) => !rd.isOk).length ?? 0

	// Convert to SsdTray format - only show detected drives in their actual slots
	const traySlots: (SsdSlot | null)[] = [1, 2, 3, 4].map((slotNum) => {
		const detected = detectedDrives.find((d) => d.slotNum === slotNum)
		if (!detected) return null
		return {
			size: formatSize(detected.device.size),
			hasWarning: detected.hasHealthWarning,
		}
	})

	return (
		<OnboardingPage>
			<div className='flex flex-1 select-none flex-col md:flex-row'>
				{/* Left side - content */}
				<div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6 md:items-start md:justify-start md:py-8 md:pl-6 md:pr-0'>
					{/* Header */}
					<div className='flex flex-col items-center gap-2 md:items-start'>
						<div className='flex items-center gap-2'>
							<TbAlertTriangleFilled className='size-[22px] text-[#F5A623]' />
							<h1
								className='text-[18px] font-bold text-white/85 md:text-[20px]'
								style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
							>
								{t('raid-error.title')}
							</h1>
						</div>
						<p className='max-w-[500px] text-center text-[14px] text-white/50 md:text-left md:text-[15px]'>
							{t('raid-error.description')}
						</p>
					</div>

					{/* Drive status */}
					<div className='flex w-full max-w-[420px] flex-col rounded-xl bg-white/5 p-3 md:max-w-none'>
						{/* Detected drives */}
						{detectedDrives.map((drive) => {
							return (
								<button
									key={drive.slotNum}
									type='button'
									onClick={() => healthDialog.openDialog(drive.device, drive.slotNum)}
									className='-mx-1 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5'
								>
									<div className='flex flex-col gap-0.5'>
										<div className='flex items-center gap-2'>
											{drive.hasHealthWarning ? (
												<TbAlertTriangle className='size-5 text-[#F5A623]' />
											) : (
												<TbCircleCheckFilled className='size-5 text-brand' />
											)}
											<span className='text-[14px] font-medium text-white/60 md:text-[15px]'>
												<Trans
													i18nKey='raid-error.ssd-in-slot'
													values={{size: formatSize(drive.device.size), slot: drive.slotNum}}
													components={{highlight: <Highlight />}}
												/>
											</span>
										</div>
										{drive.hasHealthWarning && (
											<p className='ml-7 text-[12px] text-[#F5A623]/80 md:text-[13px]'>
												{t('raid-error.health-warning')}
											</p>
										)}
									</div>
									{/* Health pill */}
									<div className='relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] px-3 py-0.5'>
										<TbActivityHeartbeat className='size-4 text-white/60' />
										{drive.hasHealthWarning && (
											<span className='absolute -right-0.5 -top-0.5'>
												<span className='absolute inset-0 size-2.5 rounded-full bg-[#F5A623]' />
												<span className='absolute inset-0 size-2.5 animate-ping rounded-full bg-[#F5A623] opacity-75' />
											</span>
										)}
									</div>
								</button>
							)
						})}

						{/* Missing SSDs warning - at bottom of card */}
						{missingDriveCount > 0 && (
							<div className='flex items-center gap-2 px-1 pt-2'>
								<TbAlertTriangleFilled className='size-5 shrink-0 text-[#FF3434]' />
								<span className='text-[14px] text-white/50 md:text-[15px]'>
									{missingDriveCount === 1
										? t('raid-error.missing-ssd-one')
										: t('raid-error.missing-ssd-multiple', {count: missingDriveCount})}
								</span>
							</div>
						)}
					</div>

					{/* Troubleshooting steps */}
					<div className='w-full max-w-[420px] md:max-w-none'>
						<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
							<TroubleshootingStep
								number={1}
								title={t('raid-error.step-restart.title')}
								description={t('raid-error.step-restart.description')}
								buttonText={t('raid-error.step-restart.button')}
								onClick={() => restart()}
							/>
							<TroubleshootingStep
								number={2}
								title={t('raid-error.step-check-connections.title')}
								description={t('raid-error.step-check-connections.description')}
								buttonText={t('raid-error.step-check-connections.button')}
								onClick={() => setShowShutdownDialog(true)}
							/>
							<TroubleshootingStep
								number={3}
								title={t('raid-error.step-factory-reset.title')}
								description={t('raid-error.step-factory-reset.description')}
								buttonText={t('raid-error.step-factory-reset.button')}
								onClick={() => setShowFactoryResetDialog(true)}
							/>
						</div>
					</div>
				</div>

				{/* Right side - SSD tray visualization (hidden on mobile) */}
				<div className='hidden flex-1 flex-col items-end justify-center md:-mr-6 md:flex'>
					<div
						className='w-[95%]'
						style={{
							maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
							WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
						}}
					>
						<SsdTray
							slots={traySlots}
							failsafeSlot={-1}
							onHealthClick={(slotIndex) => {
								const slotNum = slotIndex + 1
								const drive = detectedDrives.find((d) => d.slotNum === slotNum)
								if (drive) {
									healthDialog.openDialog(drive.device, slotNum)
								}
							}}
						/>
					</div>
				</div>
			</div>

			{/* Language selector - needed for edge case of fresh browser + RAID failure (defaults to English) */}
			<div className='flex items-center justify-center pb-2'>
				<LanguageDropdown />
			</div>

			{/* SSD Health dialog */}
			{healthDialog.selectedDevice && (
				<SsdHealthDialog
					device={healthDialog.selectedDevice.device}
					slotNumber={healthDialog.selectedDevice.slotNumber}
					open={healthDialog.open}
					onOpenChange={healthDialog.onOpenChange}
				/>
			)}

			{/* Shutdown confirmation dialog */}
			<AlertDialog open={showShutdownDialog} onOpenChange={setShowShutdownDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('raid-error.shutdown-dialog.title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('raid-error.shutdown-dialog.description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction variant='destructive' onClick={() => shutdown()} hideEnterIcon>
							{t('shut-down')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Factory reset confirmation dialog */}
			<AlertDialog open={showFactoryResetDialog} onOpenChange={setShowFactoryResetDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('raid-error.factory-reset-dialog.title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('raid-error.factory-reset-dialog.description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='destructive'
							onClick={() => factoryResetMut.mutate({})}
							disabled={factoryResetMut.isPending}
							hideEnterIcon
						>
							{t('factory-reset')}
						</AlertDialogAction>
						<AlertDialogCancel disabled={factoryResetMut.isPending}>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</OnboardingPage>
	)
}
