import {motion} from 'motion/react'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useLocation, useNavigate} from 'react-router-dom'

import {AccountCredentials} from '@/routes/onboarding/create-account'
import {trpcReact} from '@/trpc/trpc'

import {RaidError} from './raid-error'
import {useDetectStorageDevices} from './use-raid-setup'

// Minimum time to show the scanning animation (in ms)
const MIN_SCAN_DISPLAY_TIME = 3000

// Entry point for RAID onboarding flow. Detects SSDs and routes to /raid/setup if found.
// Shows inline error states for detection errors or no SSDs found.
export type RaidOnboardingVariant = 'pro' | 'generic'

export default function Raid({variant = 'pro'}: {variant?: RaidOnboardingVariant}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()
	const isGeneric = variant === 'generic'
	const basePath = isGeneric ? '/onboarding/ssd-raid' : '/onboarding/raid'
	const {devices, isDetecting, isFetching, error, refetch} = useDetectStorageDevices({genericSsd: isGeneric})

	// Get credentials passed from create-account page via React Router's location.state
	const credentials = location.state?.credentials as AccountCredentials | undefined
	const recoverableInstallQ = trpcReact.hardware.raid.hasRecoverableInstall.useQuery(undefined, {
		enabled: !!credentials,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: Infinity,
	})

	// Track minimum display time and detection complete state
	const [minTimeElapsed, setMinTimeElapsed] = useState(false)
	const [detectionComplete, setDetectionComplete] = useState(false)

	// Redirect to create-account if credentials are missing (e.g., direct URL navigation or new tab)
	useEffect(() => {
		if (!credentials) {
			navigate('/onboarding/create-account', {replace: true})
		}
	}, [credentials, navigate])

	// Start minimum display timer
	useEffect(() => {
		if (!credentials) return

		const timer = setTimeout(() => {
			setMinTimeElapsed(true)
		}, MIN_SCAN_DISPLAY_TIME)

		return () => clearTimeout(timer)
	}, [credentials])

	// Mark detection as complete once min time elapsed and not detecting
	useEffect(() => {
		if (minTimeElapsed && !isDetecting && !recoverableInstallQ.isLoading) {
			setDetectionComplete(true)
		}
	}, [minTimeElapsed, isDetecting, recoverableInstallQ.isLoading])

	// Navigate to setup if SSDs found (after detection complete)
	// Note: We only pass credentials, not devices. Setup page fetches its own fresh device list
	// to avoid stale data issues after hardware changes (e.g., user shuts down to change an SSD, boots up, refreshes current page)
	useEffect(() => {
		if (!credentials || error || recoverableInstallQ.isError) return
		if (detectionComplete && devices.length > 0 && recoverableInstallQ.data !== undefined) {
			navigate(`${basePath}/setup`, {state: {credentials}})
		}
	}, [
		basePath,
		detectionComplete,
		devices.length,
		credentials,
		navigate,
		error,
		recoverableInstallQ.isError,
		recoverableInstallQ.data,
	])

	// Don't render while redirecting due to missing credentials
	if (!credentials) return null

	// Show error state if detection failed
	if (error || recoverableInstallQ.error) {
		return (
			<RaidError
				onRetry={() => {
					void refetch()
					void recoverableInstallQ.refetch()
				}}
				retrying={isFetching || recoverableInstallQ.isFetching}
				title={t('onboarding.raid.error.detection-failed')}
				detail={error ?? recoverableInstallQ.error?.message}
				instructions={
					isGeneric
						? t('onboarding.ssd-raid.error.detection-instructions')
						: t('onboarding.raid.error.detection-instructions')
				}
			/>
		)
	}

	// Show no SSDs state if detection complete but no devices found
	if (detectionComplete && devices.length === 0) {
		return (
			<RaidError
				onRetry={() => {
					void refetch()
					void recoverableInstallQ.refetch()
				}}
				retrying={isFetching || recoverableInstallQ.isFetching}
				title={t('onboarding.raid.error.no-ssds-detected')}
				instructions={
					isGeneric
						? t('onboarding.ssd-raid.error.no-ssds-instructions')
						: t('onboarding.raid.error.no-ssds-instructions')
				}
				image={
					isGeneric
						? undefined
						: {
								src: '/assets/onboarding/no-ssd-found.webp',
								alt: t('onboarding.raid.no-ssds-alt'),
							}
				}
			/>
		)
	}

	if (isGeneric) {
		return (
			<div className='flex flex-1 flex-col items-center justify-center gap-4'>
				{/* Same spinner as the Files listing loading state */}
				<TbLoader className='white h-6 w-6 animate-spin opacity-50 shadow-xs' />
				<span className='text-[15px] text-white/85'>{t('onboarding.ssd-raid.scanning')}</span>
			</div>
		)
	}

	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-10'>
			{/* Image with scanning line overlay - the animated line serves as the loading indicator */}
			<div className='relative flex items-center justify-center'>
				<img
					src='/assets/onboarding/ssd-scan.webp'
					alt={t('onboarding.raid.scanning-alt')}
					className='aspect-square w-[300px]'
				/>
				<motion.div
					className='pointer-events-none absolute w-[340px]'
					style={{
						height: '2px',
						background: 'white',
						boxShadow: '0 0 10px 2px rgba(255, 255, 255, 0.6), 0 0 20px 4px rgba(255, 255, 255, 0.3)',
					}}
					animate={{
						y: ['-120px', '120px', '-120px'],
					}}
					transition={{
						duration: 5,
						repeat: Infinity,
						ease: 'easeInOut',
					}}
				/>
			</div>

			<span
				className='text-[15px] text-white/85'
				style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
			>
				{t('onboarding.raid.scanning')}
			</span>
		</div>
	)
}
