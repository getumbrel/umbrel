import {useQueryClient} from '@tanstack/react-query'
import {createContext, ReactNode, useContext, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {JSONTree} from 'react-json-tree'
import {usePreviousDistinct} from 'react-use'

import {ConnectionLostScreen} from '@/components/ui/connection-lost-screen'
import {BareCoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {DebugOnlyBare} from '@/components/ui/debug-only'
import {toast} from '@/components/ui/toast'
import {usePrefixedLocalStorage} from '@/hooks/use-prefixed-local-storage'
import {MigratingCover, useMigrate} from '@/providers/global-system-state/migrate'
import {RestartingCover, useRestart} from '@/providers/global-system-state/restart'
import {ShuttingDownCover, useShutdown} from '@/providers/global-system-state/shutdown'
import {RouterError, RouterOutput, trpcReact} from '@/trpc/trpc'
import {MS_PER_SECOND} from '@/utils/date-time'
import {assertUnreachable} from '@/utils/misc'

import {ResettingCover, useReset} from './reset'
import {RestoreCover} from './restore'
import {UpdatingCover, useUpdate} from './update'

type SystemStatus = RouterOutput['system']['status']
type PowerActionStatus = Extract<SystemStatus, 'restarting' | 'shutting-down'>
type PowerAction = {status: PowerActionStatus; phase: 'pending' | 'accepted'}

const GlobalSystemStateContext = createContext<{
	shutdown: () => void
	restart: () => void
	update: (manifestHash?: string) => void
	migrate: () => void
	reset: (password: string) => void
	getError(): RouterError | null
	clearError(): void
	isPowerActionPending: boolean
	// We call this before triggering a custom restart flow (e.g., RAID setup) to prevent the error boundary
	// and the status covers from replacing the flow's own progress UI when the device goes down.
	// Unlike the normal restart flow, this does NOT trigger reload-on-running behavior.
	suppressErrors: () => void
} | null>(null)

export function GlobalSystemStateProvider({children}: {children: ReactNode}) {
	const {t} = useTranslation()
	const [triggered, setTriggered] = useState(false)
	const [powerAction, setPowerAction] = useState<PowerAction>()
	const [failure, setFailure] = useState(false)
	const [restoreFailure, setRestoreFailure] = useState(false)
	const [shouldReloadOnRunning, setShouldReloadOnRunning] = usePrefixedLocalStorage('should-reload-on-running', false)
	const [shutdownComplete, setShutdownComplete] = useState(false)
	const [routerError, setRouterError] = useState<RouterError | null>(null)
	// The local-storage mirror updates one render later, so guard against scheduling the reload twice.
	const reloadScheduled = useRef(false)
	// Separate flag for suppressing errors without triggering reload-on-running (e.g., RAID setup)
	const [errorsSuppressedOnly, setErrorsSuppressedOnly] = useState(false)

	// Start over fresh when any of the supported actions is triggered
	const onMutate = () => {
		setTriggered(true)
		setPowerAction(undefined)
		setErrorsSuppressedOnly(false)
		setFailure(false)
		setRestoreFailure(false)
		setShouldReloadOnRunning(false)
		setShutdownComplete(false)
		setRouterError(null)
	}

	// Intercept factory reset errors so the triggering component can handle them.
	// Password errors (UNAUTHORIZED) are shown in the form field.
	// System errors (e.g., factory reset failed) are shown as toasts.
	const onResetError = (error: RouterError) => {
		if (error?.data?.code === 'UNAUTHORIZED') {
			setRouterError(error)
		} else {
			toast.error(t('factory-reset-failed', {message: error.message}), {area: 'umbrelos'})
		}
		setTriggered(false)

		// Prevent the post-action reload when an error occurs
		setShouldReloadOnRunning(false)
	}
	const onPowerActionError = (error: RouterError) => {
		toast.error(t('something-went-wrong'), {area: 'umbrelos', description: error.message})
		setPowerAction(undefined)
		setTriggered(false)
		setShouldReloadOnRunning(false)
	}
	const getError = () => routerError
	const clearError = () => setRouterError(null)
	// Allow external code to suppress errors (e.g., RAID setup doing its own restart flow)
	// This sets a separate flag so it doesn't trigger reload-on-running behavior
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
			setShouldReloadOnRunning(false)
		}
	}
	const acceptPowerAction = (status: PowerActionStatus) => (success: boolean) => {
		onSuccess(success)
		setPowerAction(success ? {status, phase: 'accepted'} : undefined)
	}
	const beginPowerAction = (status: PowerActionStatus) => () => {
		onMutate()
		setPowerAction({status, phase: 'pending'})
	}

	const restart = useRestart({
		onMutate: beginPowerAction('restarting'),
		onSuccess: acceptPowerAction('restarting'),
		onError: onPowerActionError,
	})
	const shutdown = useShutdown({
		onMutate: beginPowerAction('shutting-down'),
		onSuccess: acceptPowerAction('shutting-down'),
		onError: onPowerActionError,
	})
	const update = useUpdate({onMutate, onSuccess})
	const migrate = useMigrate({onMutate, onSuccess})
	const reset = useReset({onMutate, onError: onResetError})

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

	const expectedDowntime = triggered || errorsSuppressedOnly
	// A retry without cached status briefly becomes pending. Keep the message visible
	// until status returns, while leaving planned downtime to its existing UI.
	const connectionLost =
		!expectedDowntime && (systemStatusQ.isError || (systemStatusQ.isFetched && systemStatusQ.data === undefined))

	// Status is `undefined` upon mount. During a reboot, React Query can keep the
	// last successful status while newer requests fail, so error state matters too.
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
	// until the system becomes 'running' again before reloading the UI.
	// For restart and shutdown, a failed status request counts only after the
	// mutation was acknowledged. This prevents an existing connection error from
	// turning an action that never reached umbreld into a reload loop.
	useEffect(() => {
		const acceptedPowerActionWentOffline =
			powerAction?.phase === 'accepted' && (status !== 'running' || systemStatusQ.isError)
		const otherActionWentOffline = !powerAction && status !== 'running'
		if ((acceptedPowerActionWentOffline || otherActionWentOffline) && triggered && !shouldReloadOnRunning) {
			setShouldReloadOnRunning(true)
		}
	}, [powerAction, setShouldReloadOnRunning, shouldReloadOnRunning, status, systemStatusQ.isError, triggered])

	// When the system becomes running again after setting shouldReloadOnRunning
	// above, reload the UI while preserving the session, in turn
	// resetting global system state provider incl. its various state vars.
	useEffect(() => {
		if (status === 'running' && !systemStatusQ.isError && shouldReloadOnRunning && !reloadScheduled.current) {
			reloadScheduled.current = true
			// shouldReloadOnRunning is stored in local storage for when the user
			// manually reloads the page even though they shouldn't. Hence we unset it
			// explicitly here and delay for a moment to be sure that local storage
			// has been updated.
			setShouldReloadOnRunning(false)
			setTimeout(() => {
				queryClient.cancelQueries()
				location.href = '/'
			}, 500)
			return
		}
	}, [
		status,
		prevStatus,
		shouldReloadOnRunning,
		setShouldReloadOnRunning,
		queryClient,
		systemStatusQ.isError,
		triggered,
	])

	const acceptedShutdown = powerAction?.phase === 'accepted' && powerAction.status === 'shutting-down'
	const observedShutdown = !powerAction && status === 'shutting-down'
	const shutdownWentOffline =
		(acceptedShutdown || observedShutdown) && (systemStatusQ.isError || systemStatusQ.failureCount > 0)

	// Show the shutdown-complete cover after the accepted shutdown goes offline.
	// Cleanup prevents a failed attempt from completing the timer during a retry.
	useEffect(() => {
		if (!shutdownWentOffline) return
		const timeout = setTimeout(() => setShutdownComplete(true), 30 * MS_PER_SECOND)
		return () => clearTimeout(timeout)
	}, [shutdownWentOffline])

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

	// When we come back online, continue showing the previous state until the page reloads,
	// plus, when the action failed, we should show the failure cover until the user interacts with it.
	// When an external flow owns the restart UX (suppressErrors), render no cover at all — the flow
	// shows its own progress screen and handles the post-restart redirect itself.
	let statusToShow = status
	if (errorsSuppressedOnly || powerAction?.phase === 'pending') {
		statusToShow = undefined
	} else if (powerAction?.phase === 'accepted') {
		statusToShow = powerAction.status
	} else if ((triggered || failure || restoreFailure) && (!status || status === 'running')) {
		statusToShow = prevStatus
	}

	// Debug info can be activated by adding the local storage key 'debug' with a value of `true`
	const debugInfo = (
		<DebugOnlyBare>
			<div className='fixed right-0 bottom-0 origin-bottom-right scale-50' style={{zIndex: 1000}}>
				<JSONTree
					data={{
						status,
						prevStatus,
						statusToShow,
						powerAction,
						triggered,
						failure,
						restoreFailure,
						shouldReloadOnRunning,
						shutdownWentOffline,
						shutdownComplete,
						statusIsError: systemStatusQ.isError,
						failureCount: systemStatusQ.failureCount,
					}}
				/>
			</div>
		</DebugOnlyBare>
	)

	// Covers are shown based on system status; restore behaves like others now
	if (connectionLost) {
		return <ConnectionLostScreen error={systemStatusQ.error} onReconnect={() => void systemStatusQ.refetch()} />
	}

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
						restart,
						update,
						migrate,
						reset,
						getError,
						clearError,
						isPowerActionPending: powerAction?.phase === 'pending',
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
					<UpdatingCover onRetry={() => update()} />
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
