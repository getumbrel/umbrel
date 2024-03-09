import {useQueryClient} from '@tanstack/react-query'
import {createContext, ReactNode, useContext, useEffect, useState} from 'react'
import {JSONTree} from 'react-json-tree'
import {usePreviousDistinct} from 'react-use'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {DebugOnlyBare} from '@/components/ui/debug-only'
import {Loading} from '@/components/ui/loading'
import {useLocalStorage2} from '@/hooks/use-local-storage2'
import {useJwt} from '@/modules/auth/use-auth'
import {trpcReact} from '@/trpc/trpc'
import {MS_PER_SECOND} from '@/utils/date-time'
import {t} from '@/utils/i18n'

const GlobalSystemStateContext = createContext<{
	shutdown: () => void
	restart: () => void
} | null>(null)

export function GlobalSystemStateProvider({children}: {children: ReactNode}) {
	const jwt = useJwt()
	const [triggered, setTriggered] = useState(false)

	const onMutate = async () => {
		setTriggered(true)
	}

	const queryClient = useQueryClient()
	const ctx = trpcReact.useContext()

	const onSuccess = () => {
		// Cancel last query in case it returns as still running
		ctx.system.status.cancel()
		// Still delay a bit just in case.
		setTimeout(() => {
			setShouldLogout(true)
		}, MS_PER_SECOND)
	}

	const [shouldLogoutOnRunning, setShouldLogout] = useLocalStorage2<true | false>('should-logout-on-running', false)

	const restart = useRestart({
		onMutate,
		onSuccess: () => {
			setTimeout(() => {
				setShouldLogout(true)
			}, 500)
		},
	})
	const shutdown = useShutdown({onMutate, onSuccess})

	const systemStatusQ = trpcReact.system.status.useQuery(undefined, {
		refetchInterval: triggered ? 500 : 10 * MS_PER_SECOND,
	})

	const status = systemStatusQ.data
	const prevStatus = usePreviousDistinct(status)

	useEffect(() => {
		if (status === 'running' && shouldLogoutOnRunning === true) {
			setTriggered(false)
			debugger
			setShouldLogout(false)
			// Canceling queries to prevent them from causing auth errors
			queryClient.cancelQueries()
			jwt.removeJwt()
			window.location.href = '/'
			return
		}
	}, [status, shouldLogoutOnRunning, jwt, setShouldLogout])

	// When we come back online, we should continue to show the previous state until we've logged out
	const statusToShow = shouldLogoutOnRunning === true && status === 'running' ? prevStatus : status

	const debugInfo = (
		<DebugOnlyBare>
			<div
				className='fixed left-0 top-0 origin-top-left scale-50'
				style={{
					zIndex: 1000,
				}}
			>
				<JSONTree data={{status, prevStatus, triggered, shouldLogoutOnRunning}} />
			</div>
		</DebugOnlyBare>
	)

	switch (statusToShow) {
		case 'running': {
			return (
				<GlobalSystemStateContext.Provider value={{shutdown, restart}}>
					{children}
					{debugInfo}
				</GlobalSystemStateContext.Provider>
			)
		}
		case 'shutting-down': {
			return (
				<CoverMessage>
					<Loading>{t('shut-down.shutting-down')}</Loading>
					<CoverMessageParagraph>{t('shut-down.shutting-down-message')}</CoverMessageParagraph>
					{debugInfo}
				</CoverMessage>
			)
		}
		case 'restarting': {
			return (
				<CoverMessage>
					<Loading>{t('restart.restarting')}</Loading>
					<CoverMessageParagraph>{t('restart.restarting-message')}</CoverMessageParagraph>
					{debugInfo}
				</CoverMessage>
			)
		}
		default: {
			// Shouldn't happen
			return (
				<CoverMessage>
					<CoverMessageParagraph>Unexpected state</CoverMessageParagraph>
					{debugInfo}
				</CoverMessage>
			)
		}
	}
}

export function useGlobalSystemState() {
	const ctx = useContext(GlobalSystemStateContext)
	if (!ctx) throw new Error('`useGlobalSystemState` must be used within `GlobalSystemStateProvider`')

	return ctx
}

function useRestart({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: () => void}) {
	const restartMut = trpcReact.system.restart.useMutation({
		onMutate,
		onSuccess,
	})
	const restart = restartMut.mutate

	return restart
}

function useShutdown({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: () => void}) {
	const shutdownMut = trpcReact.system.shutdown.useMutation({
		onMutate,
		onSuccess,
	})
	const shutdown = shutdownMut.mutate

	return shutdown
}
