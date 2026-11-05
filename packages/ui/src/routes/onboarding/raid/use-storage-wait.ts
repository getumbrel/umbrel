import {useEffect, useState} from 'react'

// A point to offer more controls, not an estimate of how long storage work should take.
export const STORAGE_WAIT_NOTICE_DELAY_MS = 5 * 60_000

// Callers capture this timestamp when submitting the request and keep it across
// setup/reboot phases. Pass null when no operation is awaiting a result.
export function useStorageWait(startedAt: number | null) {
	const [elapsedFor, setElapsedFor] = useState<number | null>(null)
	useEffect(() => {
		if (startedAt === null) return
		const remaining = Math.max(0, STORAGE_WAIT_NOTICE_DELAY_MS - (Date.now() - startedAt))
		const timer = setTimeout(() => setElapsedFor(startedAt), remaining)
		return () => clearTimeout(timer)
	}, [startedAt])
	return startedAt !== null && elapsedFor === startedAt
}
