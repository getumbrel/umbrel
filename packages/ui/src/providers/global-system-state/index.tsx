import {useQueryClient} from '@tanstack/react-query'
import {createContext, ReactNode, useContext, useEffect, useState} from 'react'
import {JSONTree} from 'react-json-tree'
import {usePreviousDistinct} from 'react-use'

import {BareCoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {DebugOnlyBare} from '@/components/ui/debug-only'
import {useLocalStorage2} from '@/hooks/use-local-storage2'
import {useJwt} from '@/modules/auth/use-auth'
import {MigratingCover, useMigrate} from '@/providers/global-system-state/migrate'
import {RestartingCover, useRestart} from '@/providers/global-system-state/restart'
import {ShuttingDownCover, useShutdown} from '@/providers/global-system-state/shutdown'
import {RouterError, RouterOutput, trpcReact} from '@/trpc/trpc'
import {MS_PER_SECOND} from '@/utils/date-time'
import {t} from '@/utils/i18n'
import {assertUnreachable, IS_DEV} from '@/utils/misc'

import {ResettingCover, useReset} from './reset'
import {RestoreCover} from './restore'
import {UpdatingCover, useUpdate} from './update'

type SystemStatus = RouterOutput['system']['status']

const GlobalSystemStateContext = createContext<{
	shutdown: () => void
	restart: () => void
	update: () => void
	migrate: () => void
	reset: (password: string) => void
	getError(): RouterError | null
	clearError(): void
} | null>(null)

export function GlobalSystemStateProvider({children}: {children: ReactNode}) {
	const jwt = useJwt()
	const [triggered, setTriggered] = useState(false)
	const [failure, setFailure] = useState(false)
	const [shouldLogoutOnRunning, setShouldLogoutOnRunning] = useLocalStorage2('should-logout-on-running', false)
	const [startShutdownTimer, setStartShutdownTimer] = useState(false)
	const [shutdownComplete, setShutdownComplete] = useState(false)
	const [routerError, setRouterError] = useState<RouterError | null>(null)

	// Start over fresh when any of the supported actions is triggered
	const onMutate = async () => {
		setTriggered(true)
		setFailure(false)
		setShouldLogoutOnRunning(false)
		setStartShutdownTimer(false)
		setShutdownComplete(false)
		setRouterError(null)
	}

	// Intercept router errors so the triggering component can handle them,
	// for example when the confirmation password of a factory reset is invalid
	// and the router returns an 'UNAUTHORIZED' response.
	const onError = async (error: RouterError) => {
		setRouterError(error)
		setTriggered(false)
	}
	const getError = () => routerError
	const clearError = () => setRouterError(null)

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
	const shutdown = useShutdown({onMutate, onSuccess})
	const update = useUpdate({onMutate, onSuccess})
	const migrate = useMigrate({onMutate, onSuccess})
	const reset = useReset({onMutate, onSuccess, onError})

	// Force swift and fresh status updates when an action is in progress
	const systemStatusQ = trpcReact.system.status.useQuery(undefined, {
		refetchInterval: triggered ? 500 : 10 * MS_PER_SECOND,
		gcTime: 0,
	})

	// Remove restore polling; we'll show a cover based on system status like other flows

	if (!IS_DEV) {
		if (systemStatusQ.error && !triggered) {
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
				const targetPage = prevStatus === 'resetting' ? '/factory-reset/success' : '/'
				location.href = targetPage
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

	// When we come back online, we should continue to show the previous state until we've logged out,
	// plus, when the action failed, we should show the failure cover until the user interacts with it.
	const statusToShow = (triggered || failure) && (!status || status === 'running') ? prevStatus : status

	// Debug info can be activated by adding the local storage key 'debug' with a value of `true`
	const debugInfo = (
		<DebugOnlyBare>
			<div className='fixed bottom-0 right-0 origin-bottom-right scale-50' style={{zIndex: 1000}}>
				<JSONTree
					data={{
						status,
						prevStatus,
						statusToShow,
						triggered,
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
				<GlobalSystemStateContext.Provider value={{shutdown, restart, update, migrate, reset, getError, clearError}}>
					{children}
					{debugInfo}
				</GlobalSystemStateContext.Provider>
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
