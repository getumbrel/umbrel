// TODO: move to misc.ts
import {useEffect, useRef, useState} from 'react'
import {useLocation, useNavigate, useSearchParams, type Location, type To} from 'react-router-dom'

import {SettingsDialogKey} from '@/routes/settings'

export type GlobalDialogKey =
	| 'logout'
	| 'live-usage'
	| 'whats-new'
	| 'add-shortcut'
	| 'app-share-users'
	| 'troubleshoot'
	| 'terminal'
export type AppStoreDialogKey = 'updates' | 'add-community-store' | 'app-launch' | 'app-settings'
export type FilesDialogKey =
	| 'files-share-info'
	| 'files-share-users'
	| 'files-empty-trash-confirmation'
	| 'files-extension-change-confirmation'
	| 'files-permanently-delete-confirmation'
	| 'files-add-network-share'
	| 'files-format-drive'
	| 'files-cloud-add'
export type PhotosDialogKey =
	| 'photos-source'
	| 'photos-add-source'
	| 'photos-item'
	| 'photos-create-album'
	| 'photos-rename-album'
export type DialogKey = GlobalDialogKey | AppStoreDialogKey | SettingsDialogKey | FilesDialogKey | PhotosDialogKey

// Some dialog params read better unprefixed in the URL (?app=jellyfin instead
// of ?app-settings-for=jellyfin). Maps a dialog's linkToDialog param names to
// the raw query keys used in the URL; unlisted params keep the
// `<dialogKey>-` prefix. Raw keys must not collide with the pages' own query
// params. The dialogs about an app share `app`, so the app carries over when
// one opens another: its settings to its terminal, say.
const dialogParamAliases: Partial<Record<DialogKey, Record<string, string>>> = {
	'app-settings': {for: 'app', view: 'view', dependency: 'dependency'},
	troubleshoot: {for: 'app'},
	terminal: {for: 'app'},
}

export function getDialogParamKey(dialogKey: DialogKey, param: string) {
	return dialogParamAliases[dialogKey]?.[param] ?? `${dialogKey}-${param}`
}

// The URL has a single dialog slot: `dialog` names the open dialog, which owns
// the params prefixed with its key plus its unprefixed aliases. Opening,
// switching and closing a dialog all go through the two functions below, so
// the slot is always replaced whole. A param left behind would be read by the
// next dialog to share its name.

/** `searchParams` with the dialog slot emptied */
export function withoutDialog(searchParams: URLSearchParams) {
	const dialogKey = searchParams.get('dialog')
	if (dialogKey === null) return new URLSearchParams(searchParams)
	const aliases = Object.values(dialogParamAliases[dialogKey as DialogKey] ?? {})
	const isOwned = (key: string) => key === 'dialog' || key.startsWith(`${dialogKey}-`) || aliases.includes(key)
	return new URLSearchParams([...searchParams].filter(([key]) => !isOwned(key)))
}

/** `searchParams` with `dialogKey` in the dialog slot, in place of whichever dialog held it */
export function withDialog(
	searchParams: URLSearchParams,
	dialogKey: DialogKey,
	dialogParams: {[param: string]: string} = {},
) {
	const next = withoutDialog(searchParams)
	next.set('dialog', dialogKey)
	for (const [param, value] of Object.entries(dialogParams)) next.set(getDialogParamKey(dialogKey, param), value)
	return next
}

// TODO: make dialog query params typesafe

/**
 * For a dialog's `onOpenAutoFocus`: focus the dialog itself rather than its first
 * control, so the keyboard is inside the dialog (not left behind its overlay)
 * without the first option looking chosen.
 */
export function focusDialogContent(event: Event) {
	event.preventDefault()
	;(event.currentTarget as HTMLElement).focus()
}

/**
 * Runs `onExited` once `closed` is true and whatever closed with it has
 * finished animating out. Closed content stays mounted for its exit, which
 * ends when the animation does, so this is the moment to let go of what that
 * content still needs: its route, its place in the URL. The animations are
 * asked directly, so there is no duration here to keep in step with the CSS.
 */
export function useAfterExit(closed: boolean, onExited: () => void) {
	// The callback of the last render to reach the screen. A navigation renders in
	// the background first, and its callback must not run for the page still showing.
	const committedOnExited = useRef(onExited)
	useEffect(() => {
		committedOnExited.current = onExited
	})

	useEffect(() => {
		if (!closed) return
		let cancelled = false
		// Found once the closed state is in a frame. Safari can report an exit as
		// finished before drawing any of it, and by then it is back to be played
		// (see animation-start.ts).
		const frame = requestAnimationFrame(() => {
			const exits = document.getAnimations().filter(({effect}) => {
				const target = effect instanceof KeyframeEffect ? effect.target : null
				// Loops inside closed content, a spinner say, never finish
				return target?.matches('[data-state="closed"]') && Number.isFinite(effect?.getComputedTiming().endTime)
			})
			// One that gets cancelled has left as well
			Promise.allSettled(exits.map((exit) => exit.finished)).then(() => {
				if (!cancelled) committedOnExited.current()
			})
		})
		return () => {
			cancelled = true
			cancelAnimationFrame(frame)
		}
	}, [closed])
}

/**
 * Whether no navigation has started since `location` rendered. Navigations
 * render as transitions, so a newer one may not be on screen yet: React Router
 * keeps the newest entry's key in history.state.
 */
function isNewestLocation(location: Location) {
	const newestKey = window.history.state?.key
	return newestKey === undefined || newestKey === location.key
}

/**
 * Leaves for `to` once `closed` is true and the dialog or window has animated
 * out. A navigation that started in the meantime wins.
 */
export function useNavigateAfterExit(closed: boolean, to: To) {
	const navigate = useNavigate()
	const location = useLocation()

	useAfterExit(closed, () => {
		if (isNewestLocation(location)) navigate(to)
	})
}

/** Allow controlling dialog from query params */
export function useDialogOpenProps(dialogKey: DialogKey) {
	const [searchParams, setSearchParams] = useSearchParams()
	const location = useLocation()
	const [open, setOpen] = useState(false)
	const [closing, setClosing] = useState(false)

	// Update open state when url is changed from the outside
	useEffect(() => {
		setOpen(searchParams.get('dialog') === dialogKey)
		setClosing(false)
	}, [searchParams, dialogKey])

	// The params outlive the close so the exit animation can play
	useAfterExit(closing, () => {
		if (isNewestLocation(location)) setSearchParams(withoutDialog(searchParams))
	})

	const onOpenChange = (open: boolean) => {
		// Keeping this here despite `useEffect` to change open state immediately
		setOpen(open)
		setClosing(!open)
		if (open) setSearchParams(withDialog(searchParams, dialogKey))
	}

	return {open, onOpenChange}
}

/** For react router  */
export function useLinkToDialog() {
	const [searchParams] = useSearchParams()
	return (dialogKey: DialogKey, dialogParams?: {[param: string]: string}): To => ({
		search: withDialog(searchParams, dialogKey, dialogParams).toString(),
	})
}
