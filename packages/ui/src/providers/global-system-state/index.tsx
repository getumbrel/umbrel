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
import {RouterOutput, trpcReact} from '@/trpc/trpc'
import {MS_PER_SECOND} from '@/utils/date-time'
import {t} from '@/utils/i18n'
import {assertUnreachable, IS_DEV} from '@/utils/misc'

import {UpdatingCover, useUpdate} from './update'

type SystemStatus = RouterOutput['system']['status']

const GlobalSystemStateContext = createContext<{
	shutdown: () => void
	restart: () => void
	update: () => void
	migrate: () => void
} | null>(null)

// TODO: split up logic so restart, shutdown, update are done in separate components?
export function GlobalSystemStateProvider({children}: {children: ReactNode}) {
	const jwt = useJwt()
	const [triggered, setTriggered] = useState(false)
	const [shouldLogoutOnRunning, setShouldLogout] = useLocalStorage2<true | false>('should-logout-on-running', false)
	const [startShutdownTimer, setStartShutdownTimer] = useState(false)
	const [shutdownComplete, setShutdownComplete] = useState(false)

	const onMutate = async () => {
		setTriggered(true)
	}

	const queryClient = useQueryClient()
	const ctx = trpcReact.useContext()

	const onSuccess = (didWork: boolean) => {
		console.log('global-system-state: onSuccess')
		// Cancel last query in case it returns as still running
		ctx.system.status.cancel()
		// alert('shouldLogoutOnRunning: true')
		if (!didWork) {
			// TODO: Consider showing a toast here, especially right after triggering the action
			// toast.error('Failed to perform action')
			setTriggered(false)
			setShouldLogout(false)
			setStartShutdownTimer(false)
		}
	}

	// TODO: handle `onError`
	const restart = useRestart({onMutate, onSuccess})
	const shutdown = useShutdown({onMutate, onSuccess})
	const update = useUpdate({onMutate, onSuccess})
	const migrate = useMigrate({onMutate, onSuccess})

	const systemStatusQ = trpcReact.system.status.useQuery(undefined, {
		refetchInterval: triggered ? 500 : 10 * MS_PER_SECOND,
		cacheTime: 0,
	})

	if (!IS_DEV) {
		if (systemStatusQ.error && !triggered) {
			console.log('global-system-state: systemStatusQ.error')
			// This error should get caught by a parent error boundary component
			// TODO: figure out what to do about network errors
			throw systemStatusQ.error
		}
	}

	const status = systemStatusQ.data
	const prevStatus: SystemStatus = usePreviousDistinct(status) ?? 'running'

	useEffect(() => {
		if (status !== 'running' && triggered && !shouldLogoutOnRunning) {
			// This means a shutdown/restart or similar process has started
			// So we'll now wait until the system is back up and running
			// before we can log the user out
			setShouldLogout(true)
		}
	}, [setShouldLogout, shouldLogoutOnRunning, status, triggered])

	useEffect(() => {
		console.log('global-system-state: useEffect')
		if (status === 'running' && shouldLogoutOnRunning === true) {
			// Rely on page reload to reset `triggered` state
			// setTriggered(false)
			console.log('global-system-state: go to login')
			setShouldLogout(false)
			// Delay the stuff after `setShouldLogout(false)` to ensure that local storage is updated. We wouldn't want to take the user through this again
			setTimeout(() => {
				// Let the page transition update the `triggered` state
				// setTriggered(false)
				// Canceling queries to prevent them from causing auth errors
				queryClient.cancelQueries()
				jwt.removeJwt()
				window.location.href = '/'
			}, 1000)
			return
		}
	}, [status, shouldLogoutOnRunning, jwt, setShouldLogout, queryClient])

	// Start shutdown timer when status endpoint starts failing
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

	// When we come back online, we should continue to show the previous state until we've logged out
	const statusToShow = triggered === true && status === 'running' ? prevStatus : status

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

	if (systemStatusQ.isLoading) {
		return (
			<>
				<BareCoverMessage delayed>{t('trpc.checking-backend')}</BareCoverMessage>
				{debugInfo}
			</>
		)
	}

	if (statusToShow === 'shutting-down' && shutdownComplete) {
		return (
			<BareCoverMessage>
				{t('shut-down.complete')}
				<CoverMessageParagraph>{t('shut-down.complete-text')}</CoverMessageParagraph>
			</BareCoverMessage>
		)
	}

	switch (statusToShow) {
		case undefined:
		case 'running': {
			return (
				<GlobalSystemStateContext.Provider value={{shutdown, restart, update, migrate}}>
					{children}
					{debugInfo}
				</GlobalSystemStateContext.Provider>
			)
		}
		case 'shutting-down': {
			return (
				<>
					<ShuttingDownCover />
					{debugInfo}
				</>
			)
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
	}
	assertUnreachable(statusToShow)
}

export function useGlobalSystemState() {
	const ctx = useContext(GlobalSystemStateContext)
	if (!ctx) throw new Error('`useGlobalSystemState` must be used within `GlobalSystemStateProvider`')

	return ctx
}
