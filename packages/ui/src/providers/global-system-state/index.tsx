import {useQueryClient} from '@tanstack/react-query'
import {createContext, ReactNode, useContext, useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {JSONTree} from 'react-json-tree'
import {usePreviousDistinct} from 'react-use'

import {BareCoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {DebugOnlyBare} from '@/components/ui/debug-only'
import {toast} from '@/components/ui/toast'
import {usePrefixedLocalStorage} from '@/hooks/use-prefixed-local-storage'
import {useJwt} from '@/modules/auth/use-auth'
import {MigratingCover, useMigrate} from '@/providers/global-system-state/migrate'
import {RestartingCover, useRestart, useRestartWithPassword} from '@/providers/global-system-state/restart'
import {ShuttingDownCover, useShutdown, useShutdownWithPassword} from '@/providers/global-system-state/shutdown'
import {RouterError, RouterInput, RouterOutput, trpcReact} from '@/trpc/trpc'
import {MS_PER_SECOND} from '@/utils/date-time'
import {assertUnreachable, IS_DEV} from '@/utils/misc'

import {ResettingCover, useReset} from './reset'
import {RestoreCover} from './restore'
import {UpdatingCover, useUpdate} from './update'

type SystemStatus = RouterOutput['system']['status']

const GlobalSystemStateContext = createContext<{
	shutdown: () => void
	shutdownWithPassword: (input: RouterInput['system']['shutdownWithPassword']) => Promise<boolean>
	restart: () => void
	restartWithPassword: (input: RouterInput['system']['restartWithPassword']) => Promise<boolean>
	update: () => void
	migrate: () => void
	reset: (password: string) => void
	getError(): RouterError | null
	clearError(): void
	// We call this before triggering a custom restart flow (e.g., RAID setup) to prevent error boundary from showing when requests fail.
	// Unlike the normal restart flow, this does NOT trigger logout-on-running behavior.
	suppressErrors: () => void
} | null>(null)

export function GlobalSystemStateProvider({children}: {children: ReactNode}) {
	const {t} = useTranslation()
	const jwt = useJwt()
	const [triggered, setTriggered] = useState(false)
	const [failure, setFailure] = useState(false)
	const [restoreFailure, setRestoreFailure] = useState(false)
	const [shouldLogoutOnRunning, setShouldLogoutOnRunning] = usePrefixedLocalStorage('should-logout-on-running', false)
	const [startShutdownTimer, setStartShutdownTimer] = useState(false)
	const [shutdownComplete, setShutdownComplete] = useState(false)
	const [routerError, setRouterError] = useState<RouterError | null>(null)
	// Separate flag for suppressing errors without triggering logout-on-running (e.g., RAID setup)
	const [errorsSuppressedOnly, setErrorsSuppressedOnly] = useState(false)

	// Start over fresh when any of the supported actions is triggered
	const onMutate = async () => {
		setTriggered(true)
		setFailure(false)
		setRestoreFailure(false)
		setShouldLogoutOnRunning(false)
		setStartShutdownTimer(false)
		setShutdownComplete(false)
		setRouterError(null)
	}

	// Intercept router errors so the triggering component can handle them.
	// Password errors (UNAUTHORIZED) are shown in the form field.
	// System errors (e.g., factory reset failed) are shown as toasts.
	const onError = async (error: RouterError) => {
		if (error?.data?.code === 'UNAUTHORIZED') {
			setRouterError(error)
		} else {
			toast.error(t('factory-reset-failed', {message: error.message}))
		}
		setTriggered(false)

		// Prevent logout/redirect when error occurs
		setShouldLogoutOnRunning(false)
	}

	const onPowerError = async () => {
		setTriggered(false)
		setShouldLogoutOnRunning(false)
		setStartShutdownTimer(false)
		setShutdownComplete(false)
		setRouterError(null)
	}
	const getError = () => routerError
	const clearError = () => setRouterError(null)
	// Allow external code to suppress errors (e.g., RAID setup doing its own restart flow)
	// This sets a separate flag so it doesn't trigger logout-on-running behavior
	const suppressErrors = () => setErrorsSuppressedOnly(true)

	const queryClient = useQueryClient()
	const utils = trpcReact.useUtils()

	// When the action completes, remember whether it was a success or a failure
	// and potentially clean up left-over state so the failed action can be
	// attempted again. We use `failure` below to trigger the error cover.
	const onSuccess = (success: boolean) => {
		setFailure(!success)
		utils.system.status.cancel() // avoid receiving an outdated status
		if (!success) {
			setTriggered(false)
			setShouldLogoutOnRunning(false)
			setStartShutdownTimer(false)
		}
	}

	// TODO: handle `onError` for other actions than reset?
	const restart = useRestart({onMutate, onSuccess})
	const restartWithPassword = useRestartWithPassword({onMutate, onSuccess, onError: onPowerError})
	const shutdown = useShutdown({onMutate, onSuccess})
	const shutdownWithPassword = useShutdownWithPassword({onMutate, onSuccess, onError: onPowerError})
	const update = useUpdate({onMutate, onSuccess})
	const migrate = useMigrate({onMutate, onSuccess})
	const reset = useReset({onMutate, onError})

	// During triggered actions (device reboots, updates, etc.) we poll at 500ms
	// with no retry so the UI detects the backend coming back ASAP: requests fail
	// instantly (ECONNREFUSED) while the device is down, then the first success
	// triggers the post-restart redirect. Without fast polling the user would stare
	// at the cover for up to 10s after the device is already ready.
	// During normal operation we allow retries to absorb transient network blips
	// (idle tab, brief disconnection, device sleep/wake) instead of immediately
	// throwing into the root error boundary.
	const systemStatusQ = trpcReact.system.status.useQuery(undefined, {
		refetchInterval: triggered ? 500 : 10 * MS_PER_SECOND,
		gcTime: 0,
		retry: (failureCount) => {
			if (triggered) return false
			return failureCount < 3
		},
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
	})

	if (!IS_DEV) {
		if (systemStatusQ.error && !triggered && !errorsSuppressedOnly) {
			// This error should get caught by a parent error boundary component
			// TODO: figure out what to do about network errors
			// TODO: Do we need this production-only case at all?
			throw systemStatusQ.error
		}
	}

	// Status is `undefined` upon mount, then updating to the status reported by
	// the backend, plus when the system reboots, the first status query to fail
	// will report `undefined` again. Handle these cases explicitly below.
	const status = systemStatusQ.data
	const prevStatus: SystemStatus | undefined = usePreviousDistinct(status)

	// If status moves away from 'running' without onMutate (e.g., restore),
	// set `triggered` to enable fast polling and the post-restart redirect.
	useEffect(() => {
		if (!triggered && status && status !== 'running') {
			setTriggered(true)
		}
	}, [status, triggered])

	// When global system state is triggered and status switches to anything but
	// 'running', we know that the action is now in progress. So we'll now wait
	// until the system becomes 'running' again before logging the user out.
	// Here, `undefined` is a valid non-running status in that it indicates that
	// the system has stopped responding, so is likely rebooting.
	useEffect(() => {
		if (status !== 'running' && triggered && !shouldLogoutOnRunning) {
			setShouldLogoutOnRunning(true)
		}
	}, [setShouldLogoutOnRunning, shouldLogoutOnRunning, status, triggered])

	// When the system becomes running again after setting shouldLogoutOnRunning
	// above, log the user out and redirect them to the follow-up page, in turn
	// resetting global system state provider incl. its various state vars.
	useEffect(() => {
		if (status === 'running' && shouldLogoutOnRunning) {
			// shouldLogoutOnRunning is stored in local storage for when the user
			// manually reloads the page even though they shouldn't. Hence we unset it
			// explicitly here and delay for a moment to be sure that local storage
			// has been updated.
			setShouldLogoutOnRunning(false)
			setTimeout(() => {
				queryClient.cancelQueries() // prevent auth errors
				jwt.removeJwt()
				location.href = '/'
			}, 500)
			return
		}
	}, [status, prevStatus, shouldLogoutOnRunning, jwt, setShouldLogoutOnRunning, queryClient, triggered])

	// Start shutdown timer when status endpoint starts failing, showing the
	// shutdown complete cover after a sensible delay.
	useEffect(() => {
		if (
			status === 'shutting-down' &&
			!startShutdownTimer &&
			(systemStatusQ.isError || systemStatusQ.failureCount > 0)
		) {
			setStartShutdownTimer(true)
			setTimeout(() => setShutdownComplete(true), 30 * MS_PER_SECOND)
		}
	}, [startShutdownTimer, status, systemStatusQ.failureCount, systemStatusQ.isError, triggered])

	// We poll for restore errors only while the system is 'restoring' (not during other non-running states)
	// - After we just transitioned from 'restoring' -> 'running', we do one more fetch to catch an error reported at the boundary
	// - If a failure is already latched, keep enabled so the button remains available, but
	//   we won't poll (refetchInterval is 0 when not restoring)
	const isRestoring = status === 'restoring'
	const justFinishedRestoring = prevStatus === 'restoring' && status === 'running'
	const shouldPollRestoreError = isRestoring || restoreFailure || (justFinishedRestoring && !restoreFailure)

	const restoreErrorQ = trpcReact.backups.restoreStatus.useQuery(undefined, {
		enabled: shouldPollRestoreError,
		refetchInterval: isRestoring ? 500 : 0,
		select: (d) => !!d?.error,
	})

	useEffect(() => {
		if (restoreErrorQ.data) setRestoreFailure(true)
	}, [restoreErrorQ.data])

	// When we come back online, we should continue to show the previous state until we've logged out,
	// plus, when the action failed, we should show the failure cover until the user interacts with it.
	const statusToShow =
		(triggered || failure || restoreFailure) && (!status || status === 'running') ? prevStatus : status

	// Debug info can be activated by adding the local storage key 'debug' with a value of `true`
	const debugInfo = (
		<DebugOnlyBare>
			<div className='fixed right-0 bottom-0 origin-bottom-right scale-50' style={{zIndex: 1000}}>
				<JSONTree
					data={{
						status,
						prevStatus,
						statusToShow,
						triggered,
						failure,
						restoreFailure,
						shouldLogoutOnRunning,
						startShutdownTimer,
						shutdownComplete,
						statusIsError: systemStatusQ.isError,
						failureCount: systemStatusQ.failureCount,
					}}
				/>
			</div>
		</DebugOnlyBare>
	)

	// Covers are shown based on system status; restore behaves like others now

	if (systemStatusQ.isLoading) {
		return (
			<>
				<BareCoverMessage delayed>{t('trpc.checking-backend')}</BareCoverMessage>
				{debugInfo}
			</>
		)
	}

	switch (statusToShow) {
		case undefined:
		case 'running': {
			return (
				<GlobalSystemStateContext
					value={{
						shutdown,
						shutdownWithPassword,
						restart,
						restartWithPassword,
						update,
						migrate,
						reset,
						getError,
						clearError,
						suppressErrors,
					}}
				>
					{children}
					{debugInfo}
				</GlobalSystemStateContext>
			)
		}
		case 'restoring': {
			return (
				<>
					<RestoreCover />
					{debugInfo}
				</>
			)
		}
		case 'shutting-down': {
			if (shutdownComplete) {
				return (
					<BareCoverMessage>
						{t('shut-down.complete')}
						<CoverMessageParagraph>{t('shut-down.complete-text')}</CoverMessageParagraph>
					</BareCoverMessage>
				)
			} else {
				return (
					<>
						<ShuttingDownCover />
						{debugInfo}
					</>
				)
			}
		}
		case 'restarting': {
			return (
				<>
					<RestartingCover />
					{debugInfo}
				</>
			)
		}
		case 'updating': {
			return (
				<>
					<UpdatingCover onRetry={update} />
					{debugInfo}
				</>
			)
		}
		case 'migrating': {
			return (
				<>
					<MigratingCover onRetry={migrate} />
					{debugInfo}
				</>
			)
		}
		case 'resetting': {
			return (
				<>
					<ResettingCover />
					{debugInfo}
				</>
			)
		}
	}
	assertUnreachable(statusToShow)
}

export function useGlobalSystemState() {
	const ctx = useContext(GlobalSystemStateContext)
	if (!ctx) throw new Error('`useGlobalSystemState` must be used within `GlobalSystemStateProvider`')

	return ctx
}
