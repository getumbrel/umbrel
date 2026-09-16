// RAID Setup Page - kept intentionally large because it's a cohesive page flow

import {TFunction} from 'i18next'
import {useEffect, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbAlertTriangleFilled, TbCircleCheckFilled} from 'react-icons/tb'
import {TiInfoLarge} from 'react-icons/ti'
import {Link, useLocation, useNavigate} from 'react-router-dom'

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
import {Switch} from '@/components/ui/switch'
import {links} from '@/constants/links'
import {footerLinkClass, Layout, primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {Progress} from '@/modules/bare/progress'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {RecommendedBadge} from '@/routes/onboarding/recommended-badge'
import {isTransportError} from '@/trpc/is-transport-error'
import {trpcReact} from '@/trpc/trpc'
import {linkClass} from '@/utils/element-classes'

import type {RaidOnboardingVariant} from './index'
import {RaidError} from './raid-error'
import {RecoverExistingInstall} from './recover-existing-install'
import {SsdHealthDialog, useSsdHealthDialog} from './ssd-health-dialog'
import {GenericSsdTray, SsdSlot, SsdTray} from './ssd-tray'
import {
	FAILSAFE_COLOR,
	formatSize,
	getDeviceHealth,
	RaidType,
	StorageDevice,
	useDetectStorageDevices,
	WASTED_COLOR,
} from './use-raid-setup'

// ============================================================================
// Helper Functions
// ============================================================================

// Get warning message for a device (generic message - details shown in health dialog)
function getHealthWarningMessage(device: StorageDevice, t: TFunction): string | null {
	if (getDeviceHealth(device).hasWarning) return t('onboarding.raid.health-warning')
	return null
}

// Format bytes, but if 0, use the same unit as the reference value (e.g., "0TB" instead of "0B")
const formatSizeWithUnit = (bytes: number, referenceBytes: number) => {
	if (bytes === 0 && referenceBytes > 0) {
		const unit = formatSize(referenceBytes).replace(/[\d.]/g, '')
		return `0${unit}`
	}
	return formatSize(bytes)
}

// ============================================================================
// Sub-components
// ============================================================================

/** Helper component to show failsafe info text */
function FailSafeInfo({
	failsafeSize,
	unusedSize,
	deviceCount,
	smallestSize,
	isGeneric,
}: {
	failsafeSize: number
	unusedSize: number
	deviceCount: number
	smallestSize: number
	isGeneric: boolean
}) {
	const {t} = useTranslation()
	const protectionStr = formatSize(failsafeSize)
	const unusedStr = formatSize(unusedSize)
	const smallestStr = formatSize(smallestSize)

	// Mixed-size drives - show explanation and tip
	if (unusedSize > 0) {
		return (
			<div className='flex flex-col gap-2 text-[13px] text-white/50'>
				<p>{t('onboarding.raid.failsafe.mixed-sizes', {smallest: smallestStr, wasted: unusedStr})}</p>
				<p>
					<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
					{t('onboarding.raid.failsafe.tip')}
				</p>
			</div>
		)
	}

	// Generic hardware: we don't know how many bays the machine has, so never
	// suggest a specific number of extra drives - only that expansion is possible.
	// The numbered ladders below assume the Umbrel Pro's 4 slots.
	if (isGeneric) {
		return (
			<span className='text-[13px] text-white/50'>
				{t('onboarding.raid.failsafe.protection-info-generic', {protection: protectionStr})}
			</span>
		)
	}

	// Same-sized drives - show explanation and expansion hint
	if (deviceCount === 2) {
		const futureWith3 = formatSize(smallestSize * 2)
		const futureWith4 = formatSize(smallestSize * 3)
		return (
			<span className='text-[13px] text-white/50'>
				{t('onboarding.raid.failsafe.protection-info-2ssds', {
					protection: protectionStr,
					smallest: smallestStr,
					futureWith3,
					futureWith4,
				})}
			</span>
		)
	}

	if (deviceCount === 3) {
		const futureWith4 = formatSize(smallestSize * 3)
		return (
			<span className='text-[13px] text-white/50'>
				{t('onboarding.raid.failsafe.protection-info-3ssds', {
					protection: protectionStr,
					smallest: smallestStr,
					futureWith4,
				})}
			</span>
		)
	}

	// 4+ SSDs - no additional expansion hint needed
	return null
}

function SsdSummaryList({
	devices,
	showSlotNumbers,
	onHealthClick,
}: {
	devices: StorageDevice[]
	showSlotNumbers: boolean
	onHealthClick?: (device: StorageDevice) => void
}) {
	const {t} = useTranslation()

	return (
		<div className='flex flex-col rounded-xl bg-white/5 p-3'>
			{devices.map((device) => {
				const warning = getHealthWarningMessage(device, t)
				const hasWarning = getDeviceHealth(device).hasWarning
				const content = (
					<>
						<div className='flex flex-col gap-0.5'>
							<div className='flex items-center gap-2'>
								{warning ? (
									<TbAlertTriangle className='size-5 text-[#F5A623]' />
								) : (
									<TbCircleCheckFilled className='size-5 text-brand' />
								)}
								<span className='text-[14px] font-medium text-white/60 md:text-[15px]'>
									{showSlotNumbers ? (
										<Trans
											t={t}
											i18nKey='onboarding.raid.ssd-in-slot'
											values={{size: formatSize(device.roundedSize), slot: device.slot}}
											components={{highlight: <span className='text-white' />}}
										/>
									) : (
										<>
											<span className='text-white'>{formatSize(device.roundedSize)}</span>
											{' · '}
											{device.name}
										</>
									)}
								</span>
							</div>
							{warning && <p className='ml-7 text-[12px] text-[#F5A623]/80 md:text-[13px]'>{warning}</p>}
						</div>
						{onHealthClick && (
							<div className='relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] p-1 md:hidden'>
								<TiInfoLarge className='size-4 text-white/60' />
								{hasWarning && (
									<span className='absolute -top-0.5 right-1.5 translate-x-1/3 -translate-y-1/3'>
										<span className='absolute inset-0 size-2.5 rounded-full bg-[#F5A623]' />
										<span className='absolute inset-0 size-2.5 animate-ping rounded-full bg-[#F5A623] opacity-75' />
									</span>
								)}
							</div>
						)}
					</>
				)

				return onHealthClick ? (
					<button
						key={device.id}
						type='button'
						onClick={() => onHealthClick(device)}
						className='-mx-1 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5'
					>
						{content}
					</button>
				) : (
					<div key={device.id} className='flex items-center justify-between gap-2 px-1 py-1.5'>
						{content}
					</div>
				)
			})}
		</div>
	)
}

// ============================================================================
// Main Component
// ============================================================================

export default function RaidSetup({variant = 'pro'}: {variant?: RaidOnboardingVariant}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()
	const isGeneric = variant === 'generic'
	const basePath = isGeneric ? '/onboarding/ssd-raid' : '/onboarding/raid'

	// Get credentials from React Router's location.state (passed from create-account page)
	// location.state survives page refresh (browser History API), lost only on direct URL navigation or new tab.
	// If lost, we redirect to create-account.
	//
	// IMPORTANT: If user refreshes page while device is rebooting, they'll see network errors until the device comes
	// back online, then be redirected to login (since user now exists). They won't see the success page, but the setup still completes successfully.
	const credentials = location.state?.credentials as AccountCredentials | undefined

	// Always fetch fresh devices from server in case user shut down to change an SSD and refreshes current url
	const {devices, isDetecting} = useDetectStorageDevices({genericSsd: isGeneric})
	const recoverableInstallQ = trpcReact.hardware.raid.hasRecoverableInstall.useQuery(undefined, {
		enabled: !!credentials,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: Infinity,
	})
	const [setUpAsNew, setSetUpAsNew] = useState(false)

	// FailSafe rendering logic:
	// ┌─────────────────────────┬─────────────┬─────────────┬─────────────────┐
	// │ Configuration           │ Can Enable  │ Recommended │ Default State   │
	// ├─────────────────────────┼─────────────┼─────────────┼─────────────────┤
	// │ 1 SSD                   │ No          │ —           │ OFF (disabled)  │
	// │ 2+ SSDs, same size      │ Yes         │ Yes         │ ON              │
	// │ 2+ SSDs, mixed sizes    │ Yes         │ No          │ OFF             │
	// └─────────────────────────┴─────────────┴─────────────┴─────────────────┘

	const canEnableFailSafe = devices.length >= 2
	// Check if all drives have the same roundedSize (backend rounds to nearest 250GB for ≥1TB drives)
	const roundedSizes = devices.map((d) => d.roundedSize)
	const smallestRounded = roundedSizes.length > 0 ? Math.min(...roundedSizes) : 0
	const allSameSize = roundedSizes.length > 0 && roundedSizes.every((s) => s === smallestRounded)
	const defaultFailSafe = canEnableFailSafe && allSameSize
	// Device detection is asynchronous, so derive the default until the user
	// explicitly changes it. Initializing a boolean from the first (empty) query
	// result incorrectly left the recommended option off once drives arrived.
	const [failSafeChoice, setFailSafeChoice] = useState<boolean | null>(null)
	const failSafeEnabled = failSafeChoice ?? defaultFailSafe

	// Shutdown confirmation dialog state
	const [showShutdownDialog, setShowShutdownDialog] = useState(false)
	const [showEraseDialog, setShowEraseDialog] = useState(false)

	// Setup phase: null | 'setting-up' | 'restarting' | 'complete' | 'error'
	const [setupPhase, setSetupPhase] = useState<null | 'setting-up' | 'restarting' | 'complete' | 'error'>(null)

	// Track if we're launching (stays true through navigation to prevent button flash)
	const [isLaunching, setIsLaunching] = useState(false)

	// SSD Health dialog state
	const healthDialog = useSsdHealthDialog()

	// Poll for RAID setup completion after reboot
	// This endpoint returns: true (complete), false (in progress), or throws (failed)
	// We disable retry to avoid exponential backoff - we just want to detect when it completes ASAP
	const raidStatusQ = trpcReact.hardware.raid.checkInitialRaidSetupStatus.useQuery(undefined, {
		enabled: setupPhase === 'restarting',
		refetchInterval: setupPhase === 'restarting' ? 2000 : false,
		retry: false,
	})

	// Handle RAID setup completion or failure
	useEffect(() => {
		if (setupPhase !== 'restarting') return

		// Setup complete - pool exists, user created, app store synced
		if (raidStatusQ.data === true) {
			setSetupPhase('complete')
		}

		// Only an error the server answered with (it rethrows initialRaidSetupError) means setup
		// failed. Transport errors are expected while the device reboots - keep polling.
		if (raidStatusQ.isError && !isTransportError(raidStatusQ.error)) {
			setSetupPhase('error')
		}
	}, [setupPhase, raidStatusQ.data, raidStatusQ.isError, raidStatusQ.error])

	// Auth for auto-login on success
	const auth = useAuth()

	// Get global system state to suppress errors during our custom restart flow
	const {suppressErrors, shutdown} = useGlobalSystemState()

	// Login mutation for auto-login after setup complete
	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: (token) => {
			auth.signUpWithToken(token, '/')
		},
		onError: () => {
			// If login fails, just redirect to login page
			window.location.href = '/'
		},
	})

	// Register mutation - this will set up RAID, save credentials, and trigger reboot
	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: () => {
			// Registration succeeded - device will reboot
			// Transition to restarting phase
			setSetupPhase('restarting')
		},
		onError: () => {
			setSetupPhase(null)
		},
	})

	// Redirect to create-account if credentials are missing (e.g., direct URL navigation or new tab)
	useEffect(() => {
		if (!credentials) {
			navigate('/onboarding/create-account', {replace: true})
		}
	}, [credentials, navigate])

	// Redirect to detect page if still detecting or no devices found
	useEffect(() => {
		if (!credentials) return
		if (isDetecting || devices.length === 0) {
			navigate(basePath, {state: {credentials}, replace: true})
		}
	}, [basePath, isDetecting, devices.length, credentials, navigate])

	// Don't render while redirecting
	if (!credentials || isDetecting || devices.length === 0) {
		return null
	}

	if (recoverableInstallQ.isLoading) {
		return (
			<Layout
				title={t('onboarding.raid.recovery.checking.title')}
				subTitle={t('onboarding.raid.recovery.checking.subtitle')}
				subTitleMaxWidth={430}
				showLogo={false}
			>
				{!isGeneric && (
					<img
						src='/assets/onboarding/pro-front.webp'
						alt={t('storage-manager.umbrel-pro')}
						draggable={false}
						className='w-64 md:w-96'
					/>
				)}
				<div className='mt-4 w-full max-w-sm'>
					<Progress />
				</div>
			</Layout>
		)
	}

	if (recoverableInstallQ.error) {
		return (
			<RaidError
				title={t('onboarding.raid.error.detection-failed')}
				instructions={t('onboarding.raid.recovery.checking.failed')}
			/>
		)
	}

	if (recoverableInstallQ.data && !setUpAsNew) {
		return <RecoverExistingInstall devices={devices} variant={variant} onSetUpAsNew={() => setSetUpAsNew(true)} />
	}

	// --- Event Handlers ---

	// Handle continue button - register with RAID config
	const handleContinue = () => {
		if (!credentials) {
			// No credentials - shouldn't happen, but navigate back to create account
			navigate('/onboarding/create-account', {replace: true})
			return
		}

		// Suppress global system state errors before triggering reboot
		// This prevents the error boundary from showing "Something went wrong" during the expected network downtime
		suppressErrors()

		setSetupPhase('setting-up')

		// Get device IDs for RAID setup
		const raidDevices = devices.map((d) => d.id).filter((id): id is string => id !== undefined)
		const raidType: RaidType = failSafeEnabled ? 'failsafe' : 'storage'

		// Call register with credentials and RAID config
		// Backend will: set up ZFS pool, save credentials to config, trigger reboot
		registerMut.mutate({
			name: credentials.name,
			password: credentials.password,
			language: credentials.language,
			raidDevices,
			raidType,
		})
	}

	// Handle shutdown
	const handleShutdown = () => {
		shutdown()
	}

	// --- Derived State & Calculations ---

	// We show the smallest drive as "failsafe" because it determines the usable capacity per drive.
	// Use the last smallest device when multiple drives share that size.
	const smallestSize = devices.length > 0 ? Math.min(...devices.map((d) => d.roundedSize)) : 0
	const smallestDevices = devices.filter((d) => d.roundedSize === smallestSize)
	const smallestDevice = smallestDevices[smallestDevices.length - 1]

	// Umbrel Pro has a fixed four-slot layout. Generic devices preserve the detected
	// device order and can render any number of SSDs without inventing slot numbers.
	const proSlots: (SsdSlot | null)[] = [null, null, null, null]
	devices.forEach((device) => {
		const slotIndex = (device.slot ?? 0) - 1 // slot is 1-indexed
		if (slotIndex >= 0 && slotIndex < 4) {
			proSlots[slotIndex] = {
				size: formatSize(device.roundedSize),
				hasWarning: getDeviceHealth(device).hasWarning,
			}
		}
	})
	const genericSlots: SsdSlot[] = devices.map((device) => ({
		size: formatSize(device.roundedSize),
		hasWarning: getDeviceHealth(device).hasWarning,
		label: device.name,
	}))
	const visualSlots = isGeneric ? genericSlots : proSlots

	const failsafeSlot =
		failSafeEnabled && canEnableFailSafe && smallestDevice
			? isGeneric
				? devices.indexOf(smallestDevice)
				: (smallestDevice.slot ?? 0) - 1
			: -1

	// Calculate storage values based on failsafe config
	// FailSafe uses RAIDZ1: one drive's worth of capacity for parity (based on smallest drive)
	// Formula: available = (n-1) × smallest, failsafe = smallest, wasted = total - available - failsafe
	//
	// Examples:
	// ┌────────────────────────┬───────────┬──────────┬────────┐
	// │ Configuration          │ Available │ FailSafe │ Wasted │
	// ├────────────────────────┼───────────┼──────────┼────────┤
	// │ 1×2TB (no failsafe)    │ 2TB       │ —        │ —      │
	// │ 2×2TB (same size)      │ 2TB       │ 2TB      │ 0      │
	// │ 3×2TB (same size)      │ 4TB       │ 2TB      │ 0      │
	// │ 4×2TB (same size)      │ 6TB       │ 2TB      │ 0      │
	// │ 2TB + 4TB (mixed)      │ 2TB       │ 2TB      │ 2TB    │
	// │ 2TB + 2TB + 4TB        │ 4TB       │ 2TB      │ 2TB    │
	// └────────────────────────┴───────────┴──────────┴────────┘

	const totalRoundedBytes = devices.reduce((sum, d) => sum + d.roundedSize, 0)

	let availableBytes: number
	let failsafeBytes: number
	let unusedBytes: number

	if (failSafeEnabled && canEnableFailSafe) {
		failsafeBytes = smallestSize
		availableBytes = (devices.length - 1) * smallestSize
		unusedBytes = Math.max(0, totalRoundedBytes - availableBytes - failsafeBytes)
	} else {
		failsafeBytes = 0
		availableBytes = totalRoundedBytes
		unusedBytes = 0
	}

	const availableStorage = formatSize(availableBytes)
	const failsafeStorage = formatSizeWithUnit(failsafeBytes, availableBytes)
	const unusedStorage = formatSizeWithUnit(unusedBytes, availableBytes)

	// --- Render: Error State ---

	// Show error state if registration failed (pre-reboot) or RAID setup failed (post-reboot)
	const errorMessage =
		registerMut.error?.message ||
		raidStatusQ.error?.message ||
		'The storage pool could not be mounted after the device restarted.'
	if (registerMut.error || setupPhase === 'error') {
		const canRetry = !!registerMut.error // Can only retry pre-reboot errors
		return (
			<div className='flex flex-1 flex-col items-center justify-center gap-4'>
				<TbAlertTriangleFilled className='size-[22px] text-[#F5A623]' />
				<h1
					className='text-[20px] font-bold text-white/85'
					style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
				>
					{t('onboarding.raid.setup-failed.title')}
				</h1>
				<p className='max-w-[300px] text-center text-[15px] text-white/70'>{errorMessage}</p>
				<p className='max-w-[300px] text-center text-[13px] text-white/50'>
					{canRetry
						? t('onboarding.raid.setup-failed.description-retry')
						: t('onboarding.raid.setup-failed.description-no-retry')}
				</p>
				<div className='mt-0 flex gap-3'>
					{canRetry && (
						<button
							onClick={() => {
								registerMut.reset()
								setSetupPhase(null)
							}}
							className={primaryButtonProps.className}
							style={primaryButtonProps.style}
						>
							{t('onboarding.raid.try-again')}
						</button>
					)}
					<button onClick={handleShutdown} className={secondaryButtonClasss}>
						{t('shut-down')}
					</button>
				</div>
			</div>
		)
	}

	// --- Render: Progress State ---

	// Show setup progress state (covers both ZFS pool creation and post-reboot user setup)
	if (setupPhase === 'setting-up' || setupPhase === 'restarting') {
		return (
			<Layout
				title={t('onboarding.raid.configuring.title')}
				subTitle={t('onboarding.raid.configuring.subtitle')}
				subTitleMaxWidth={400}
				showLogo={false}
				footer={
					<div className='w-full max-w-sm'>
						<p className='text-center text-sm text-white/60'>{t('onboarding.raid.configuring.warning')}</p>
					</div>
				}
			>
				{!isGeneric && (
					<>
						<img
							src='/assets/onboarding/pro-front.webp'
							alt={t('storage-manager.umbrel-pro')}
							draggable={false}
							className='w-64 md:w-96'
						/>
						<p className='-mt-4 text-[13px] font-medium text-white/30'>{t('storage-manager.umbrel-pro')}</p>
					</>
				)}
				{/* Progress bar */}
				<div className='mt-4 w-full max-w-sm'>
					<Progress />
				</div>
			</Layout>
		)
	}

	// --- Render: Success State ---

	// Show success page after setup is complete
	// RAID onboarding uses this inline success page (not /onboarding/account-created) because we need to
	// display storage/failsafe details and handle auto-login after reboot
	if (setupPhase === 'complete') {
		// Get first name from credentials
		const firstName = credentials?.name?.split(' ')[0] || ''
		return (
			<Layout
				title={t('onboarding.account-created.youre-all-set-name', {name: firstName})}
				subTitle={
					<Trans
						t={t}
						i18nKey='onboarding.account-created.by-clicking-button-you-agree'
						components={{
							linked: <Link to={links.legal.tos} className={linkClass} target='_blank' />,
						}}
					/>
				}
				subTitleMaxWidth={630}
				subTitleClassName='text-white/50'
				showLogo={false}
				footer={
					<div className='flex flex-col items-center gap-3'>
						<Link to={links.support} target='_blank' className={footerLinkClass}>
							{t('onboarding.contact-support')}
						</Link>
					</div>
				}
			>
				{!isGeneric && (
					<>
						<img
							src='/assets/onboarding/pro-front.webp'
							alt={t('storage-manager.umbrel-pro')}
							draggable={false}
							className='w-64 md:w-96'
						/>
						<p className='-mt-2 text-[20px] font-semibold text-white/85'>{t('storage-manager.umbrel-pro')}</p>
					</>
				)}
				{/* They just chose this setup; only the Pro shows its stats line under the device photo */}
				{!isGeneric && (
					<p className='-mt-5 text-[14px] font-medium text-white/50'>
						{failSafeEnabled
							? t('onboarding.raid.success.storage-info-failsafe', {
									available: availableStorage,
									failsafe: failsafeStorage,
								})
							: t('onboarding.raid.success.storage-info', {available: availableStorage})}
					</p>
				)}

				<button
					onClick={() => {
						setIsLaunching(true)
						if (credentials?.password) {
							// Try to auto-login with the credentials we have
							loginMut.mutate({password: credentials.password, totpToken: ''})
						} else {
							// No credentials, just redirect to login
							window.location.href = '/'
						}
					}}
					disabled={isLaunching}
					className={`mt-4 ${primaryButtonProps.className}`}
					style={primaryButtonProps.style}
				>
					{isLaunching ? t('onboarding.raid.launching') : t('onboarding.launch-umbrelos')}
				</button>
			</Layout>
		)
	}

	// --- Render: Main Setup Form ---

	return (
		<div className='flex flex-1 flex-col md:flex-row'>
			{/* Left side - content (full width on mobile) */}
			<div className='flex flex-1 flex-col justify-start gap-4 px-4 py-6 md:pt-10 md:pr-0 md:pb-0 md:pl-6'>
				<div className='flex flex-col gap-1 md:gap-2'>
					<h1
						className='text-[20px] font-bold text-white/85 md:text-[24px]'
						style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
					>
						{t('onboarding.raid.storage')}
					</h1>
					<p className='text-[14px] text-white/50 md:text-[16px]'>
						{isGeneric ? t('onboarding.ssd-raid.ssds-found') : t('onboarding.raid.ssds-found')}
					</p>
				</div>

				<SsdSummaryList
					devices={devices}
					showSlotNumbers={!isGeneric}
					onHealthClick={(device) => healthDialog.openDialog(device, isGeneric ? undefined : device.slot)}
				/>

				{/* Shut down link */}
				<button
					onClick={() => setShowShutdownDialog(true)}
					className='w-fit text-[13px] text-white/50 underline-offset-2 transition-colors hover:text-white/70 hover:underline'
				>
					{t('onboarding.raid.change-drives-link')}
				</button>

				{/* Divider */}
				<div className='border-t border-white/10' />

				{/* FailSafe section */}
				<div className='flex flex-col gap-3 md:gap-4'>
					<div className='flex flex-col gap-1 md:gap-2'>
						<h2
							className='text-[18px] font-semibold text-white/85 md:text-[20px]'
							style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
						>
							{t('onboarding.raid.failsafe')}
						</h2>
						<p className='text-[14px] text-white/50 md:text-[16px]'>{t('onboarding.raid.failsafe.subtitle')}</p>
					</div>

					{canEnableFailSafe ? (
						/* Toggle card - shown when 2+ SSDs */
						<div className='flex flex-col gap-4 rounded-xl bg-white/5 p-4'>
							<div className='flex items-center justify-between'>
								<div className='flex items-center gap-3'>
									<Switch checked={failSafeEnabled} onCheckedChange={setFailSafeChoice} />
									<span className='text-[15px] text-white/85'>{t('onboarding.raid.failsafe.enable')}</span>
								</div>
								{allSameSize && <RecommendedBadge small />}
							</div>

							{/* Storage breakdown bar - only shown when enabled */}
							{failSafeEnabled && (
								<div className='flex flex-col gap-2'>
									<div className='flex text-[14px]'>
										<span style={{width: `${(availableBytes / totalRoundedBytes) * 100}%`}}>
											<span className='text-brand'>{t('onboarding.raid.storage-label')}</span>{' '}
											<span className='font-medium text-brand opacity-60'>{availableStorage}</span>
										</span>
										<span style={{width: `${(failsafeBytes / totalRoundedBytes) * 100}%`}}>
											<span style={{color: FAILSAFE_COLOR}}>{t('onboarding.raid.failsafe')}</span>{' '}
											<span className='font-medium opacity-60' style={{color: FAILSAFE_COLOR}}>
												{failsafeStorage}
											</span>
										</span>
										{unusedBytes > 0 && (
											<span style={{width: `${(unusedBytes / totalRoundedBytes) * 100}%`}}>
												<span style={{color: WASTED_COLOR}}>{t('onboarding.raid.wasted')}</span>{' '}
												<span className='font-medium opacity-60' style={{color: WASTED_COLOR}}>
													{unusedStorage}
												</span>
											</span>
										)}
									</div>
									{/* Progress bar */}
									<div className='flex h-2 w-full overflow-hidden rounded-full'>
										{/* Storage */}
										<div
											className='h-full bg-brand'
											style={{width: `${(availableBytes / totalRoundedBytes) * 100}%`}}
										/>
										{/* Failsafe */}
										<div
											className='h-full'
											style={{
												width: `${(failsafeBytes / totalRoundedBytes) * 100}%`,
												backgroundColor: FAILSAFE_COLOR,
											}}
										/>
										{/* Wasted - only if there's unused storage */}
										{unusedBytes > 0 && (
											<div
												className='h-full'
												style={{width: `${(unusedBytes / totalRoundedBytes) * 100}%`, backgroundColor: WASTED_COLOR}}
											/>
										)}
									</div>
								</div>
							)}

							{failSafeEnabled ? (
								<FailSafeInfo
									failsafeSize={failsafeBytes}
									unusedSize={unusedBytes}
									deviceCount={devices.length}
									smallestSize={smallestSize}
									isGeneric={isGeneric}
								/>
							) : (
								<p className='text-[13px] text-white/50'>
									<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
									{t('onboarding.raid.failsafe.warning-now-only')}
								</p>
							)}
						</div>
					) : (
						/* Info card - shown when only 1 SSD. Not a warning: continuing with one
						   SSD is a fine setup, FailSafe just isn't applicable yet. */
						<div className='rounded-xl bg-white/5 p-4 text-[14px] text-white/50'>
							{t('onboarding.raid.failsafe.single-ssd-info', {size: devices[0] ? formatSize(devices[0].size) : ''})}
						</div>
					)}

					{/* Continue button */}
					<button
						onClick={() => (isGeneric ? setShowEraseDialog(true) : handleContinue())}
						{...primaryButtonProps}
						className={`${primaryButtonProps.className} w-full md:w-fit`}
					>
						{t('onboarding.raid.continue')}
					</button>

					{/* Generic hardware gets an explicit erase confirmation dialog instead */}
					{!isGeneric && (
						<p className='-mt-1 text-[12px] text-white/40'>
							{t('onboarding.raid.erase-footnote', {count: devices.length})}
						</p>
					)}
				</div>
			</div>

			{/* Right side - shared SSD visualization (hidden on mobile) */}
			<div
				className={`hidden min-w-0 flex-1 flex-col justify-center md:flex ${isGeneric ? 'items-center' : 'items-end md:-mr-6'}`}
			>
				{/* The bottom fade suits the Pro chassis photo; the generic enclosure is a bounded card */}
				<div
					className={isGeneric ? 'w-full' : 'w-[95%]'}
					style={
						isGeneric
							? undefined
							: {
									maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
									WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
								}
					}
				>
					{isGeneric ? (
						<GenericSsdTray
							slots={visualSlots}
							failsafeSlot={failsafeSlot}
							onHealthClick={(deviceIndex) => {
								const device = devices[deviceIndex]
								if (device) healthDialog.openDialog(device)
							}}
						/>
					) : (
						<SsdTray
							slots={visualSlots}
							failsafeSlot={failsafeSlot}
							onHealthClick={(slotIndex) => {
								const device = devices.find((candidate) => candidate.slot === slotIndex + 1)
								if (device) healthDialog.openDialog(device, slotIndex + 1)
							}}
						/>
					)}
				</div>
				<div
					className={`flex flex-col items-center gap-1 ${isGeneric ? 'mt-2 w-full' : '-mt-20 w-[95%] translate-x-4'}`}
				>
					<p className='text-[20px] font-semibold text-white/50'>
						{t('onboarding.raid.available-storage')} <span className='text-brand'>{availableStorage}</span>
					</p>
					{/* With a single SSD FailSafe isn't available at all, so a "FailSafe 0TB" line would only confuse */}
					{canEnableFailSafe && (
						<p className='text-[14px] text-white/50'>
							{t('onboarding.raid.failsafe')} <span style={{color: FAILSAFE_COLOR}}>{failsafeStorage}</span>
							{unusedBytes > 0 && (
								<>
									{` · ${t('onboarding.raid.wasted')} `}
									<span style={{color: WASTED_COLOR}}>{unusedStorage}</span>
								</>
							)}
						</p>
					)}
				</div>
			</div>

			{/* Shutdown confirmation dialog */}
			<AlertDialog open={showShutdownDialog} onOpenChange={setShowShutdownDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('onboarding.raid.shutdown-dialog.title')}</AlertDialogTitle>
						<AlertDialogDescription>
							{isGeneric
								? t('onboarding.ssd-raid.shutdown-dialog.description')
								: t('onboarding.raid.shutdown-dialog.description')}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => shutdown()}>{t('shut-down')}</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Generic hardware always confirms the destructive operation in the UI. */}
			{isGeneric && (
				<AlertDialog open={showEraseDialog} onOpenChange={setShowEraseDialog}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{t('onboarding.ssd-raid.erase-dialog.title')}</AlertDialogTitle>
							<AlertDialogDescription>{t('onboarding.ssd-raid.erase-dialog.description')}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
							<AlertDialogAction onClick={handleContinue}>
								{t('onboarding.raid.recovery.set-up-new-dialog.confirm')}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}

			{/* SSD Health dialog */}
			{healthDialog.selectedDevice && (
				<SsdHealthDialog
					device={healthDialog.selectedDevice.device}
					slotNumber={healthDialog.selectedDevice.slotNumber}
					open={healthDialog.open}
					onOpenChange={healthDialog.onOpenChange}
				/>
			)}
		</div>
	)
}
