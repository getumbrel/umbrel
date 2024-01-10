// TODO: move to misc.ts
import {useEffect, useState} from 'react'
import type {To} from 'react-router-dom'

import {useQueryParams} from '@/hooks/use-query-params'
import {SettingsDialogKey} from '@/routes/settings'
import {sleep} from '@/utils/misc'

export const EXIT_DURATION_MS = 200

export type GlobalDialogKey = 'logout'
export type AppStoreDialogKey = 'updates' | 'add-community-store' | 'default-credentials'
export type DialogKey = GlobalDialogKey | AppStoreDialogKey | SettingsDialogKey
/**
 * For use with dialogs and other Radix elements with an `onOpenChange` prop.
 */
export function afterDelayedClose(cb?: () => void) {
	return (open: boolean) => !open && sleep(EXIT_DURATION_MS).then(cb)
}

export function useAfterDelayedClose(open: boolean, cb: () => void) {
	useEffect(() => {
		const id = setTimeout(() => {
			if (!open) cb()
		}, EXIT_DURATION_MS)

		// Cancel the timeout if the component unmounts or the `open` prop changes.
		return () => clearTimeout(id)
	}, [open, cb])
}

/** Allow controlling dialog from query params */
export function useDialogOpenProps(dialogKey: DialogKey) {
	const {params, add, remove} = useQueryParams()
	const [open, setOpen] = useState(false)

	// Update open state when url is changed from the outside
	useEffect(() => {
		setOpen(params.get('dialog') === dialogKey)
	}, [params, dialogKey])

	const addQueryParam = () => add('dialog', dialogKey)
	const removeQueryParam = async () => {
		await sleep(EXIT_DURATION_MS)
		remove('dialog')
	}

	const onOpenChange = (open: boolean) => {
		// Keeping this here despite `useEffect` to change open state immediately
		setOpen(open)
		if (open) {
			addQueryParam()
		} else {
			removeQueryParam()
		}
	}

	return {open, onOpenChange}
}

/** For react router  */
export function useLinkToDialog() {
	const {addLinkSearchParams} = useQueryParams()
	return (dialogKey: DialogKey): To => ({
		search: addLinkSearchParams({dialog: dialogKey}),
	})
}
