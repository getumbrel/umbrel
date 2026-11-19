// Creating the storage that was chosen: user.register, the restart that follows, and the
// launch. Every storage setup page ends here, so they all wait, fail and finish alike.

import {useEffect, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import type {Setup, StorageConfig} from '@/features/storage/model'
import {DoneStage, FailedStage, WorkingStage} from '@/features/storage/setup/stages'
import {ShutDownDialog} from '@/features/storage/setup/storage-step'
import {footerLinkClass} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import type {AccountCredentials} from '@/routes/onboarding/create-account'
import {ReturnToStart} from '@/routes/onboarding/raid/return-to-start'
import {useStorageWait} from '@/routes/onboarding/raid/use-storage-wait'
import {isTransportError} from '@/trpc/is-transport-error'
import {trpcReact} from '@/trpc/trpc'
import {linkClass} from '@/utils/element-classes'

// What was set up, for the screen that follows
export type StorageSummary = NonNullable<React.ComponentProps<typeof DoneStage>['storage']>

export const summaryOf = (setup: Setup): StorageSummary => ({
	usable: setup.capacity.usable,
	kind: setup.kind,
	level: setup.layout === 'stripe' ? null : setup.layout,
	accel: setup.accel.chosen.length,
})

type Chosen = {config: StorageConfig; summary?: StorageSummary}

export function useCreateStorage(credentials: AccountCredentials | undefined) {
	// null until the person has confirmed their storage
	const [phase, setPhase] = useState<null | 'setting-up' | 'restarting' | 'complete' | 'error'>(null)
	// What the person chose, kept for a retry and for the launch screen
	const [chosen, setChosen] = useState<Chosen | null>(null)

	const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null)
	const showWaitNotice = useStorageWait(phase === 'setting-up' || phase === 'restarting' ? requestStartedAt : null)

	// Track if we're launching (stays true through navigation to prevent button flash)
	const [isLaunching, setIsLaunching] = useState(false)

	// Poll for RAID setup completion after reboot
	// This endpoint returns: true (complete), false (in progress), or throws (failed)
	// We disable retry to avoid exponential backoff - we just want to detect when it completes ASAP
	const raidStatusQ = trpcReact.hardware.raid.checkInitialRaidSetupStatus.useQuery(undefined, {
		enabled: phase === 'restarting',
		refetchInterval: phase === 'restarting' ? 2000 : false,
		retry: false,
	})

	// Handle RAID setup completion or failure
	useEffect(() => {
		if (phase !== 'restarting') return

		// Setup complete - pool exists, user created, app store synced
		if (raidStatusQ.data === true) setPhase('complete')

		// Only an error the server answered with (it rethrows initialRaidSetupError) means setup
		// failed. Transport errors are expected while the device reboots - keep polling.
		if (raidStatusQ.isError && !isTransportError(raidStatusQ.error)) setPhase('error')
	}, [phase, raidStatusQ.data, raidStatusQ.isError, raidStatusQ.error])

	// Auth for auto-login on success
	const auth = useAuth()

	// Get global system state to suppress errors during our custom restart flow
	const {suppressErrors} = useGlobalSystemState()

	// Login mutation for auto-login after setup complete
	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: (token) => auth.signUpWithToken(token, '/'),
		onError: () => {
			// If login fails, just redirect to login page
			window.location.href = '/'
		},
	})

	// Register mutation - this will set up RAID, save credentials, and trigger reboot
	const registerMut = trpcReact.user.register.useMutation({
		// Registration succeeded - device will reboot
		onSuccess: () => setPhase('restarting'),
		// A lost answer says nothing about the setup, which may well be under way
		onError: (error) => setPhase(isTransportError(error) ? 'restarting' : 'error'),
	})

	// Register with the storage that was chosen. umbreld creates it, saves the account, and restarts.
	const start = (config: StorageConfig, summary?: StorageSummary) => {
		if (!credentials) return
		// Suppress global system state errors before triggering reboot
		// This prevents the error boundary from showing "Something went wrong" during the expected network downtime
		suppressErrors()
		setChosen({config, summary})
		setRequestStartedAt(Date.now())
		setPhase('setting-up')
		registerMut.mutate({
			name: credentials.name,
			password: credentials.password,
			language: credentials.language,
			...config,
		})
	}

	return {
		phase,
		start,
		summary: chosen?.summary,
		showWaitNotice,
		// Only a refusal umbreld answered with can be tried again: once the restart has begun,
		// the account may exist and registering twice is refused
		canRetry: !!chosen && !!registerMut.error && !isTransportError(registerMut.error),
		retry: () => {
			if (!chosen) return
			registerMut.reset()
			start(chosen.config, chosen.summary)
		},
		detail: registerMut.error?.message ?? raidStatusQ.error?.message,
		checking: raidStatusQ.isFetching,
		checkAgain: () => void raidStatusQ.refetch(),
		isLaunching,
		launch: () => {
			setIsLaunching(true)
			if (credentials?.password) {
				// Try to auto-login with the credentials we have
				loginMut.mutate({password: credentials.password, totpToken: ''})
			} else {
				// No credentials, just redirect to login
				window.location.href = '/'
			}
		},
	}
}

// The screens from the moment the storage is confirmed. Render once `creation.phase` is set.
export function CreatingStorage({
	creation,
	isPro,
	ssd = isPro,
	name,
}: {
	creation: ReturnType<typeof useCreateStorage>
	isPro: boolean
	// The machine has nothing but SSDs, so it is told about SSDs
	ssd?: boolean
	// The person's name, as they gave it
	name?: string
}) {
	const {t} = useTranslation()
	const {shutdown} = useGlobalSystemState()
	const [shuttingDown, setShuttingDown] = useState(false)
	const {phase} = creation

	if (phase === 'error') {
		return (
			<>
				<FailedStage
					ssd={ssd}
					canRetry={creation.canRetry}
					detail={creation.detail}
					onRetry={creation.retry}
					onShutdown={() => setShuttingDown(true)}
				/>
				<ShutDownDialog
					isPro={isPro}
					ssd={ssd}
					open={shuttingDown}
					onOpenChange={setShuttingDown}
					onShutdown={() => shutdown()}
					reason='check'
				/>
			</>
		)
	}

	// The launch screen is shown here, not at /onboarding/account-created, because it follows
	// a restart and signs the person in with the password they have just chosen
	if (phase === 'complete') {
		return (
			<DoneStage
				isPro={isPro}
				name={name?.split(' ')[0] || undefined}
				storage={creation.summary}
				launching={creation.isLaunching}
				onLaunch={creation.launch}
				terms={
					<p className='max-w-[420px] text-center text-13 leading-snug text-white/50'>
						<Trans
							t={t}
							i18nKey='onboarding.account-created.by-clicking-button-you-agree'
							values={{button: t('onboarding.launch-umbrelos')}}
							components={{
								linked: <Link to={links.legal.tos} className={linkClass} target='_blank' />,
							}}
						/>
					</p>
				}
				footer={
					<Link to={links.support} target='_blank' className={footerLinkClass}>
						{t('onboarding.contact-support')}
					</Link>
				}
			/>
		)
	}

	// Creating the storage, then the restart, then umbrelOS setting the account up
	return (
		<WorkingStage
			isPro={isPro}
			ssd={ssd}
			step={phase === 'restarting' ? 'restarting' : 'preparing'}
			waiting={creation.showWaitNotice ? 'still-working' : undefined}
			checking={creation.checking}
			onCheckAgain={phase === 'restarting' ? creation.checkAgain : undefined}
			actions={creation.showWaitNotice ? <ReturnToStart /> : undefined}
		/>
	)
}
