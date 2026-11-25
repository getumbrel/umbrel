import type {trpcReact} from '@/trpc/trpc'

// How long files have to have been left alone before a search of them is
// asked again
const QUIET_MS = 500
let pending: ReturnType<typeof setTimeout> | undefined

// What a search found is out of date once files change: one may have been
// moved, renamed, trashed. A search on screen is asked again for that, and it
// is the costliest thing umbreld is asked: it reads the words with a model
// each time, one search at a time. Changes come in runs (fifty files copied
// settle fifty times, one after another), so it is asked once, when they have
// gone quiet. Nothing waits on it: the files themselves are already as they
// will be.
export function refreshSearchSoon(utils: ReturnType<typeof trpcReact.useUtils>) {
	clearTimeout(pending)
	pending = setTimeout(() => void utils.search.query.invalidate(), QUIET_MS)
}
