import {useCallback, useEffect, useRef, useState} from 'react'

import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {isTransportError} from '@/trpc/is-transport-error'
import {trpcReact} from '@/trpc/trpc'

import {useStorageWait} from './use-storage-wait'

// The existing API acknowledges recovery but has no recovery-job status. Use
// fresh system-status reads to observe its reboot; a lost response stays uncertain
// unless the system or restored account provides evidence of completion.
export function useRecoverExistingInstall() {
	const {suppressErrors} = useGlobalSystemState()
	const utils = trpcReact.useUtils()
	const recoverMut = trpcReact.hardware.raid.recoverExistingInstall.useMutation()
	const [phase, setPhase] = useState<'idle' | 'requesting' | 'waiting' | 'unknown' | 'failed'>('idle')
	const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null)
	const requestPending = useRef(false)
	const rebootExpected = useRef(false)
	const [checking, setChecking] = useState(false)
	const inFlight = useRef(false)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])

	const checkStatus = useCallback(async () => {
		if (inFlight.current) return
		inFlight.current = true
		setChecking(true)
		try {
			const signal = AbortSignal.timeout(10_000)
			const status = await utils.client.system.status.query(undefined, {signal})
			if (!mounted.current) return
			if (status === 'restarting') {
				rebootExpected.current = true
				if (!requestPending.current) setPhase('waiting')
				return
			}
			if (status !== 'running' || requestPending.current) return
			// A successful mutation sets system status to restarting before it replies.
			// The provider client bypasses cached pre-reboot status.
			if (rebootExpected.current) {
				window.location.href = '/'
				return
			}
			// With a lost response, running alone could be the original process. Only
			// leave this screen if the restored account or a boot failure is observable.
			const [userExists, mountFailed] = await Promise.all([
				utils.client.user.exists.query(undefined, {signal}),
				utils.client.hardware.raid.checkRaidMountFailure.query(undefined, {signal}),
			])
			if (!mounted.current) return
			if (userExists || mountFailed) window.location.href = '/'
			// No account and no mount-error marker cannot prove the request failed.
			// Keep the outcome unconfirmed; never automatically repeat recovery.
		} catch {
			// The device may still be restarting. No mutation is retried here.
		} finally {
			inFlight.current = false
			if (mounted.current) setChecking(false)
		}
	}, [utils])

	const awaitingResult = phase === 'waiting' || phase === 'unknown'
	useEffect(() => {
		if (!awaitingResult) return
		let canceled = false
		let timer: ReturnType<typeof setTimeout>
		const poll = async () => {
			await checkStatus()
			if (!canceled) timer = setTimeout(poll, 2000)
		}
		void poll()
		return () => {
			canceled = true
			clearTimeout(timer)
		}
	}, [awaitingResult, checkStatus])

	const restoreRequested = phase !== 'idle'
	const showWaitNotice = useStorageWait(restoreRequested && phase !== 'failed' ? requestStartedAt : null)

	const handleRestore = async () => {
		if (requestPending.current || (phase !== 'idle' && phase !== 'failed')) return
		requestPending.current = true
		rebootExpected.current = false
		setRequestStartedAt(Date.now())
		suppressErrors()
		setPhase('requesting')
		recoverMut.reset()
		try {
			const recovered = await recoverMut.mutateAsync()
			rebootExpected.current = recovered
			if (mounted.current) setPhase(recovered ? 'waiting' : 'failed')
		} catch (error) {
			if (mounted.current)
				setPhase(isTransportError(error as Parameters<typeof isTransportError>[0]) ? 'unknown' : 'failed')
		} finally {
			requestPending.current = false
		}
	}

	return {
		handleRestore,
		restoreRequested,
		restoreFailed: phase === 'failed',
		outcomeUnknown: phase === 'unknown',
		showWaitNotice,
		checkStatus,
		checking,
		errorMessage: recoverMut.error?.message,
	}
}
