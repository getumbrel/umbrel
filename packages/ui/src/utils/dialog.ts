// TODO: move to misc.ts
import {useEffect, useState} from 'react'
import {useSearchParams, type To} from 'react-router-dom'

import {SettingsDialogKey} from '@/routes/settings'
import {sleep} from '@/utils/misc'

export const EXIT_DURATION_MS = 100

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
 * For use with dialogs and other Radix elements with an `onOpenChange` prop.
 */
export function afterDelayedClose(cb?: () => void) {
	return (open: boolean) => !open && sleep(EXIT_DURATION_MS).then(cb)
}

export function useAfterDelayedClose(open: boolean, cb: () => void, delayMs: number = EXIT_DURATION_MS) {
	useEffect(() => {
		const id = setTimeout(() => {
			if (!open) cb()
		}, delayMs)

		// Cancel the timeout if the component unmounts or the `open` prop changes.
		return () => clearTimeout(id)
	}, [open, cb, delayMs])
}

/** Allow controlling dialog from query params */
export function useDialogOpenProps(dialogKey: DialogKey) {
	const [searchParams, setSearchParams] = useSearchParams()
	const [open, setOpen] = useState(false)

	// Update open state when url is changed from the outside
	useEffect(() => {
		setOpen(searchParams.get('dialog') === dialogKey)
	}, [searchParams, dialogKey])

	const onOpenChange = (open: boolean) => {
		// Keeping this here despite `useEffect` to change open state immediately
		setOpen(open)
		if (open) setSearchParams(withDialog(searchParams, dialogKey))
		// The params outlive the close so the exit animation can play
		else sleep(EXIT_DURATION_MS).then(() => setSearchParams(withoutDialog(searchParams)))
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
