import {useEffect, useRef} from 'react'

import {batchActivity} from '@/features/files/utils/batch-activity'
import {trpcReact} from '@/trpc/trpc'

// Above this many distinct changed directories per flush window it's cheaper
// to refresh every listing than to target them one by one
const MAX_TARGETED_INVALIDATIONS = 25

// Cache-level refresh for directory listings: when something else (another
// session, an MCP agent, an app) changes files on disk, every mounted
// files.list query for an affected directory refetches, and unmounted ones
// are marked stale for their next mount. The watcher emits one event per
// file, so bursts collapse into one invalidation pass per second, and a
// change touching many directories falls back to one refresh-everything pass.
// While this session is itself working through a batch (see batchActivity),
// the pass waits for it to finish.
export function useWatcherRefetch() {
	const utils = trpcReact.useUtils()
	const dirtyRef = useRef<Set<string> | 'all'>(new Set())
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
	const flushRef = useRef(() => {})
	flushRef.current = () => {
		const dirty = dirtyRef.current
		if (dirty !== 'all' && dirty.size === 0) return
		dirtyRef.current = new Set()
		if (dirty === 'all') utils.files.list.invalidate()
		else for (const path of dirty) utils.files.list.invalidate({path})
	}

	useEffect(() => {
		const stopListening = batchActivity.onIdle(() => flushRef.current())
		return () => {
			stopListening()
			clearTimeout(timerRef.current)
			timerRef.current = undefined
		}
	}, [])

	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:watcher:change'},
		{
			onData(data) {
				// The server converts the event's path to a virtual path and, for
				// members, only streams paths their account may see
				const {type, path} = data as {type: string; path: string}
				if (dirtyRef.current !== 'all') {
					const parent = path.slice(0, path.lastIndexOf('/'))
					if (parent) dirtyRef.current.add(parent)
					// A deleted path may itself be a directory someone is viewing
					if (type === 'delete') dirtyRef.current.add(path)
					if (dirtyRef.current.size > MAX_TARGETED_INVALIDATIONS) dirtyRef.current = 'all'
				}
				timerRef.current ??= setTimeout(() => {
					timerRef.current = undefined
					// A batch of our own is still changing things: it is all read when it finishes
					if (!batchActivity.isRunning()) flushRef.current()
				}, 1000)
			},
			onError(err) {
				console.error('eventBus.listen(files:watcher:change) subscription error', err)
			},
		},
	)
}
