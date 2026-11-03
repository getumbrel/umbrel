import {useCallback, useEffect, useRef, useState} from 'react'
import {useNavigate, useSearchParams} from 'react-router-dom'

const ID_PARAM = 'photos-item-id'
// How long an item must stay current before the URL is told about it
const URL_SETTLE_MS = 400

// Which item the lightbox is on. The URL says which one it opens on (a tile, a
// deep link, ⌘K, back/forward), but the viewer's own steps live in state and
// reach the URL only once they have rested. Writing every step there was a
// navigation per step — asynchronous, so a fast flick along the strip had late
// ids landing after the strip had let go and yanking it back; and a flick
// through a hundred photos is a hundred `history.replaceState` calls, past
// which Safari throws (a SecurityError the router doesn't catch).
//
// The URL's id is adopted whenever it changes to one this hook didn't write.
// Its own writes swap the id in place (one history entry per lightbox
// session), never twice for the same id, and only while the URL still holds
// this dialog: a write landing after the close must not bring it back.
// `commitUrl` writes the current id at once and holds any further writes
// until the next session — for the close, so the URL names the item it closed
// on for as long as the close takes.
export function useViewerItemId(open: boolean) {
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
	const urlId = searchParams.get(ID_PARAM) ?? undefined
	const [currentId, setCurrentId] = useState(urlId)
	// The id this hook last wrote, to tell its own echo from a navigation
	const writtenRef = useRef<string | undefined>(undefined)
	const [seenUrlId, setSeenUrlId] = useState(urlId)
	if (urlId !== seenUrlId) {
		setSeenUrlId(urlId)
		if (urlId !== writtenRef.current) setCurrentId(urlId)
	}

	const heldRef = useRef(false)
	const write = useCallback(
		(target: string) => {
			if (heldRef.current) return
			// The live URL, not a render's snapshot of it: the close (or back)
			// may have taken the dialog out of it since
			const next = new URLSearchParams(window.location.search)
			if (next.get('dialog') !== 'photos-item' || next.get(ID_PARAM) === target) return
			next.set(ID_PARAM, target)
			writtenRef.current = target
			navigate({search: `?${next}`}, {replace: true})
		},
		[navigate],
	)

	// A new session starts writable and with nothing of its own in the URL
	useEffect(() => {
		if (open) heldRef.current = false
		else writtenRef.current = undefined
	}, [open])

	// The id reaches the URL once it has stayed put for a beat; any step in
	// the meantime starts the wait over, and closing cancels it
	useEffect(() => {
		if (!open || !currentId) return
		const handle = setTimeout(() => write(currentId), URL_SETTLE_MS)
		return () => clearTimeout(handle)
	}, [open, currentId, write])

	const currentRef = useRef(currentId)
	currentRef.current = currentId
	const commitUrl = useCallback(() => {
		if (currentRef.current) write(currentRef.current)
		heldRef.current = true
	}, [write])

	const goTo = useCallback((target?: string) => {
		if (target && !heldRef.current) setCurrentId(target)
	}, [])

	return {currentId, goTo, commitUrl}
}
