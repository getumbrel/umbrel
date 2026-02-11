// RAID Setup Page - kept intentionally large because it's a cohesive page flow

import {useEffect, useState} from 'react'
import {Trans} from 'react-i18next/TransWithoutContext'
import {IoShieldHalf} from 'react-icons/io5'
import {TbActivityHeartbeat, TbAlertTriangle, TbAlertTriangleFilled, TbCircleCheckFilled} from 'react-icons/tb'
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
import {footerLinkClass, Layout, primaryButtonProps} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {Progress} from '@/modules/bare/progress'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {trpcReact} from '@/trpc/trpc'
import {linkClass} from '@/utils/element-classes'
import {t} from '@/utils/i18n'

import {SsdHealthDialog, useSsdHealthDialog} from './ssd-health-dialog'
import {SsdSlot, SsdTray} from './ssd-tray'
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
function getHealthWarningMessage(device: StorageDevice): string | null {
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
}: {
	failsafeSize: number
	unusedSize: number
	deviceCount: number
	smallestSize: number
}) {
	const protectionStr = formatSize(failsafeSize)
	const unusedStr = formatSize(unusedSize)
	const smallestStr = formatSize(smallestSize)

	// Mixed-size drives - show explanation and tip
	if (unusedSize > 0) {
		return (
			<div className='flex flex-col gap-2 text-[13px] text-white/50'>
				<p>{t('onboarding.raid.failsafe.mixed-sizes', {smallest: smallestStr, wasted: unusedStr})}</p>
				<p className='text-yellow-500'>💡 {t('onboarding.raid.failsafe.tip')}</p>
			</div>
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

	// 4 SSDs - fully expanded, no additional text needed
	return null
}

// ============================================================================
// Main Component
// ============================================================================

export default function RaidSetup() {
	const navigate = useNavigate()
	const location = useLocation()

	// Get credentials from React Router's location.state (passed from create-account page)
	// location.state survives page refresh (browser History API), lost only on direct URL navigation or new tab.
	// If lost, we redirect to create-account.
	//
	// IMPORTANT: If user refreshes page while device is rebooting, they'll see network errors until the device comes
	// back online, then be redirected to login (since user now exists). They won't see the success page, but the setup still completes successfully.
	const credentials = location.state?.credentials as AccountCredentials | undefined

	// Always fetch fresh devices from server in case user shut down to change an SSD and refreshes current url
	const {devices, isDetecting} = useDetectStorageDevices()

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
	const [failSafeEnabled, setFailSafeEnabled] = useState(defaultFailSafe)

	// Shutdown confirmation dialog state
	const [showShutdownDialog, setShowShutdownDialog] = useState(false)

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

		// Check for actual server errors (not network errors during reboot)
		// Network errors like "fetch failed" are expected while device is rebooting - just keep polling
		// Server errors (e.g., initialRaidSetupError) indicate actual setup failure
		if (raidStatusQ.isError) {
			const errorMessage = raidStatusQ.error?.message ?? ''
			const isNetworkError = errorMessage.includes('fetch failed') || errorMessage.includes('Failed to fetch')
			if (!isNetworkError) {
				// Actual server error - setup failed
				setSetupPhase('error')
			}
			// Network error - ignore, keep polling (device is probably still rebooting)
		}
	}, [setupPhase, raidStatusQ.data, raidStatusQ.isError, raidStatusQ.error])

	// Auth for auto-login on success
	const auth = useAuth()

	// Get global system state to suppress errors during our custom restart flow
	const {suppressErrors, shutdown} = useGlobalSystemState()

	// Login mutation for auto-login after setup complete
	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: (jwt) => {
			auth.signUpWithJwt(jwt, '/')
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
			navigate('/onboarding/raid', {state: {credentials}, replace: true})
		}
	}, [isDetecting, devices.length, credentials, navigate])

	// Don't render while redirecting
	if (!credentials || isDetecting || devices.length === 0) {
		return null
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
	// Get the last slot device with the smallest roundedSize.
	const smallestSize = devices.length > 0 ? Math.min(...devices.map((d) => d.roundedSize)) : 0
	const smallestDevices = devices.filter((d) => d.roundedSize === smallestSize)
	const smallestDeviceSlot = smallestDevices.length > 0 ? (smallestDevices[smallestDevices.length - 1].slot ?? -1) : -1

	// Convert devices to slots array for SsdTray visualization
	// Uses the slot property from each device (1-4)
	const slots: (SsdSlot | null)[] = [null, null, null, null]
	devices.forEach((device) => {
		const slotIndex = (device.slot ?? 0) - 1 // slot is 1-indexed
		if (slotIndex >= 0 && slotIndex < 4) {
			slots[slotIndex] = {
				size: formatSize(device.roundedSize),
				hasWarning: getDeviceHealth(device).hasWarning,
			}
		}
	})

	// The failsafe slot is the smallest drive (when failsafe is enabled)
	const failsafeSlot = failSafeEnabled && canEnableFailSafe && smallestDeviceSlot > 0 ? smallestDeviceSlot - 1 : -1

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
	const errorMessage = registerMut.error?.message || raidStatusQ.error?.message
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
					<button
						onClick={handleShutdown}
						className='flex h-[42px] min-w-[112px] items-center justify-center rounded-full bg-destructive2 px-4 text-14 font-medium text-white ring-destructive2/40 transition-all duration-300 hover:bg-destructive2-lighter focus:outline-hidden focus-visible:ring-3 active:scale-100 active:bg-destructive2 disabled:pointer-events-none disabled:opacity-50'
						style={{boxShadow: '0px 2px 4px 0px rgba(255, 255, 255, 0.25) inset'}}
					>
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
				<img
					src='/assets/onboarding/pro-front.webp'
					alt={t('storage-manager.umbrel-pro')}
					draggable={false}
					className='w-64 md:w-96'
				/>
				<p className='-mt-4 text-[13px] font-medium text-white/30'>{t('storage-manager.umbrel-pro')}</p>
				{/* Progress bar */}
				<div className='mt-4 w-full max-w-sm'>
					<Progress />
				</div>
			</Layout>
		)
	}

	// --- Render: Success State ---

	// Show success page after setup is complete
	// Note: Pro uses this inline success page (not /onboarding/account-created) because we need to
	// display storage/failsafe details and handle auto-login after reboot
	if (setupPhase === 'complete') {
		// Get first name from credentials
		const firstName = credentials?.name?.split(' ')[0] || ''
		return (
			<Layout
				title={t('onboarding.account-created.youre-all-set-name', {name: firstName})}
				subTitle={
					<Trans
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
				<img
					src='/assets/onboarding/pro-front.webp'
					alt={t('storage-manager.umbrel-pro')}
					draggable={false}
					className='w-64 md:w-96'
				/>
				<p className='-mt-2 text-[20px] font-semibold text-white/85'>{t('storage-manager.umbrel-pro')}</p>
				<p className='-mt-5 text-[14px] font-medium text-white/50'>
					{failSafeEnabled
						? t('onboarding.raid.success.storage-info-failsafe', {
								available: availableStorage,
								failsafe: failsafeStorage,
							})
						: t('onboarding.raid.success.storage-info', {available: availableStorage})}
				</p>

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
					<p className='text-[14px] text-white/50 md:text-[16px]'>{t('onboarding.raid.ssds-found')}</p>
				</div>

				{/* SSD list card */}
				<div className='flex flex-col rounded-xl bg-white/5 p-3'>
					{devices.map((device) => {
						const warning = getHealthWarningMessage(device)
						const hasWarning = getDeviceHealth(device).hasWarning
						return (
							<button
								key={device.id}
								type='button'
								onClick={() => healthDialog.openDialog(device, device.slot ?? 0)}
								className='-mx-1 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5'
							>
								<div className='flex flex-col gap-0.5'>
									<div className='flex items-center gap-2'>
										{warning ? (
											<TbAlertTriangle className='size-5 text-[#F5A623]' />
										) : (
											<TbCircleCheckFilled className='size-5 text-brand' />
										)}
										<span className='text-[14px] font-medium text-white/60 md:text-[15px]'>
											<Trans
												i18nKey='onboarding.raid.ssd-in-slot'
												values={{size: formatSize(device.roundedSize), slot: device.slot}}
												components={{highlight: <span className='text-white' />}}
											/>
										</span>
									</div>
									{warning && <p className='ml-7 text-[12px] text-[#F5A623]/80 md:text-[13px]'>{warning}</p>}
								</div>
								{/* Health pill - mobile only (desktop has device visualization) */}
								<div className='relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] px-3 py-0.5 md:hidden'>
									<TbActivityHeartbeat className='size-4 text-white/60' />
									{/* Warning dot with ping - positioned to intersect pill edge */}
									{hasWarning && (
										<span className='absolute -top-0.5 right-1.5 translate-x-1/3 -translate-y-1/3'>
											<span className='absolute inset-0 size-2.5 rounded-full bg-[#F5A623]' />
											<span className='absolute inset-0 size-2.5 animate-ping rounded-full bg-[#F5A623] opacity-75' />
										</span>
									)}
								</div>
							</button>
						)
					})}
				</div>

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
									<Switch checked={failSafeEnabled} onCheckedChange={setFailSafeEnabled} />
									<span className='text-[15px] text-white/85'>{t('onboarding.raid.failsafe.enable')}</span>
								</div>
								{allSameSize && (
									<div className='flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1'>
										<IoShieldHalf className='size-4 text-brand' />
										<span className='text-[13px] text-brand'>{t('onboarding.raid.recommended')}</span>
									</div>
								)}
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
								/>
							) : (
								<p className='text-[13px] text-yellow-500'>
									<TbAlertTriangle className='mr-1 mb-0.5 inline size-4 align-middle' />
									{t('onboarding.raid.failsafe.warning-now-only')}
								</p>
							)}
						</div>
					) : (
						/* Info card - shown when only 1 SSD */
						<div className='flex flex-col items-center rounded-xl bg-white/5 p-6 text-center'>
							<TbAlertTriangle
								className='size-5 text-[#D7BF44]'
								style={{filter: 'drop-shadow(0 0 8px rgba(215, 191, 68, 0.46))'}}
							/>
							<span className='mt-3 text-[15px] font-medium text-white/85'>
								{t('onboarding.raid.failsafe.cant-enable')}
							</span>
							<span className='mt-1 text-[14px] text-white/50'>
								{t('onboarding.raid.failsafe.single-ssd-info', {size: devices[0] ? formatSize(devices[0].size) : ''})}
							</span>
						</div>
					)}

					{/* Continue button */}
					<button
						onClick={handleContinue}
						{...primaryButtonProps}
						className={`${primaryButtonProps.className} w-full md:w-fit`}
					>
						{t('onboarding.raid.continue')}
					</button>
				</div>
			</div>

			{/* Right side - device visualization (hidden on mobile) */}
			<div className='hidden flex-1 flex-col items-end justify-center md:-mr-6 md:flex'>
				<div
					className='w-[95%]'
					style={{
						maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
						WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
					}}
				>
					<SsdTray
						slots={slots}
						failsafeSlot={failsafeSlot}
						onHealthClick={(slotIndex) => {
							// Find the device for this slot (slots are 0-indexed, device.slot is 1-indexed)
							const device = devices.find((d) => d.slot === slotIndex + 1)
							if (device) {
								healthDialog.openDialog(device, slotIndex + 1)
							}
						}}
					/>
				</div>
				<div className='-mt-20 flex w-[95%] translate-x-4 flex-col items-center gap-1'>
					<p className='text-[20px] font-semibold text-white/50'>
						{t('onboarding.raid.available-storage')} <span className='text-brand'>{availableStorage}</span>
					</p>
					<p className='text-[14px] text-white/50'>
						{t('onboarding.raid.failsafe')} <span style={{color: FAILSAFE_COLOR}}>{failsafeStorage}</span>
						{unusedBytes > 0 && (
							<>
								{` · ${t('onboarding.raid.wasted')} `}
								<span style={{color: WASTED_COLOR}}>{unusedStorage}</span>
							</>
						)}
					</p>
				</div>
			</div>

			{/* Shutdown confirmation dialog */}
			<AlertDialog open={showShutdownDialog} onOpenChange={setShowShutdownDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('onboarding.raid.shutdown-dialog.title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('onboarding.raid.shutdown-dialog.description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction variant='destructive' onClick={() => shutdown()}>
							{t('shut-down')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

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
