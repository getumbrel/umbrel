// HDD RAID setup progress page. Registration triggers the pool build and a reboot, so
// this page (like the Pro raid/setup route) has no EnsureUserDoesntExist guard: after
// the reboot the backend creates the user from saved credentials while we keep polling
// until setup completes, then show the launch screen and auto-login.

import {useEffect, useRef, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {TbAlertTriangleFilled} from 'react-icons/tb'
import {Link, useLocation, useNavigate} from 'react-router-dom'

import {links} from '@/constants/links'
import {footerLinkClass, Layout, primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {Progress} from '@/modules/bare/progress'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {isTransportError} from '@/trpc/is-transport-error'
import {trpcReact} from '@/trpc/trpc'
import {linkClass} from '@/utils/element-classes'

import {HddRaidSetupConfig} from './use-hdd-raid-onboarding'

export default function HddRaidSetup() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	const credentials = location.state?.credentials as AccountCredentials | undefined
	const config = location.state?.config as HddRaidSetupConfig | undefined

	const [phase, setPhase] = useState<'setting-up' | 'restarting' | 'complete' | 'error'>('setting-up')
	const [isLaunching, setIsLaunching] = useState(false)

	const auth = useAuth()
	const {suppressErrors, shutdown} = useGlobalSystemState()

	// Poll for RAID setup completion after reboot: true (complete), false (in progress),
	// or throws (failed). Transport errors are expected while the device reboots.
	const raidStatusQ = trpcReact.hardware.raid.checkInitialRaidSetupStatus.useQuery(undefined, {
		enabled: phase === 'restarting',
		refetchInterval: phase === 'restarting' ? 2000 : false,
		retry: false,
	})

	useEffect(() => {
		if (phase !== 'restarting') return
		if (raidStatusQ.data === true) setPhase('complete')
		// Only an error the server answered with means setup failed - keep polling through the reboot
		if (raidStatusQ.isError && !isTransportError(raidStatusQ.error)) setPhase('error')
	}, [phase, raidStatusQ.data, raidStatusQ.isError, raidStatusQ.error])

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: (token) => auth.signUpWithToken(token, '/'),
		onError: () => {
			window.location.href = '/'
		},
	})

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: () => setPhase('restarting'),
		onError: () => setPhase('error'),
	})

	const register = () => {
		if (!credentials || !config) return
		// Suppress global system state errors before the expected reboot downtime
		suppressErrors()
		setPhase('setting-up')
		registerMut.mutate({
			name: credentials.name,
			password: credentials.password,
			language: credentials.language,
			raidDevices: config.raidDevices,
			raidType: config.raidType,
			acceleratorDevices: config.acceleratorDevices,
		})
	}

	// Register exactly once on mount; the previous step's Continue is the user's confirmation
	const startedRef = useRef(false)
	useEffect(() => {
		if (!credentials || !config) {
			navigate('/onboarding/create-account', {replace: true})
			return
		}
		if (startedRef.current) return
		startedRef.current = true
		register()
	}, [])

	if (!credentials || !config) return null

	// --- Error state ---
	if (phase === 'error') {
		const canRetry = !!registerMut.error // Only pre-reboot errors can be retried
		const errorMessage =
			registerMut.error?.message ||
			raidStatusQ.error?.message ||
			'The HDD pool could not be mounted after the device restarted.'
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
				<div className='flex gap-3'>
					{canRetry && (
						<button
							onClick={() => {
								registerMut.reset()
								register()
							}}
							className={primaryButtonProps.className}
							style={primaryButtonProps.style}
						>
							{t('onboarding.raid.try-again')}
						</button>
					)}
					<button onClick={() => shutdown()} className={secondaryButtonClasss}>
						{t('shut-down')}
					</button>
				</div>
			</div>
		)
	}

	// --- Launch state ---
	// Same success page as the Pro and SSD RAID flows: hero title, ToS note, one compact
	// stats line, and the launch button
	if (phase === 'complete') {
		const firstName = credentials.name?.split(' ')[0] || ''
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
				<button
					onClick={() => {
						setIsLaunching(true)
						loginMut.mutate({password: credentials.password, totpToken: ''})
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

	// --- Progress state ---
	// The same configuring cover the Pro and SSD RAID flows show while the pool builds
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
			<div className='mt-4 w-full max-w-sm'>
				<Progress />
			</div>
		</Layout>
	)
}
