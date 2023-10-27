// TODO: move to misc.ts
import {useEffect} from 'react'

import {sleep} from '@/utils/misc'

export const EXIT_DURATION_MS = 200

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
