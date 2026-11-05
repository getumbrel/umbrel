import React, {Suspense} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useSearchParams} from 'react-router-dom'

import {trpcReact} from '@/trpc/trpc'
import {type GlobalDialogKey} from '@/utils/dialog'

type GlobalDialogOptions = {
	/** umbreld refuses these to members, so the dialog never mounts for them */
	ownerOnly?: boolean
}

function globalDialog(
	load: () => Promise<{default: React.ComponentType}>,
	{ownerOnly = false}: GlobalDialogOptions = {},
) {
	return {load, Component: React.lazy(load), ownerOnly}
}

const globalDialogs = new Map<GlobalDialogKey, ReturnType<typeof globalDialog>>([
	['logout', globalDialog(() => import('@/modules/desktop/logout-dialog'))],
	['live-usage', globalDialog(() => import('@/routes/live-usage'))],
	['whats-new', globalDialog(() => import('@/routes/whats-new-modal'))],
	['troubleshoot', globalDialog(() => import('@/routes/settings/troubleshoot'), {ownerOnly: true})],
	['terminal', globalDialog(() => import('@/routes/settings/terminal'), {ownerOnly: true})],
])

/**
 * The dialogs that open over whichever page is showing, from `?dialog=<key>`.
 * One mounts only while it holds the URL's dialog slot, so a closed dialog
 * costs nothing: its chunk isn't fetched until it first opens. Closing keeps
 * the slot through the exit animation (see `useDialogOpenProps`), so the
 * dialog is still mounted to play it.
 */
export function GlobalDialogs() {
	const [searchParams] = useSearchParams()
	const userQ = trpcReact.user.get.useQuery()

	const dialogKey = searchParams.get('dialog') as GlobalDialogKey
	const dialog = globalDialogs.get(dialogKey)
	const Dialog = dialog && (!dialog.ownerOnly || userQ.data?.role === 'owner') ? dialog.Component : null

	return (
		// The boundary stays mounted while the dialogs come and go. Navigations are
		// transitions, which hold the page as it is while a boundary that's already
		// showing waits on a chunk, so the dialog being left stays up until the one
		// replacing it can mount. A boundary that mounted with its dialog would
		// commit its empty fallback first, and React holds a fallback for 300ms.
		<Suspense>
			{Dialog && (
				// Keyed so that one dialog failing doesn't take the rest down with it
				<ErrorBoundary key={dialogKey} fallbackRender={() => null}>
					<Dialog />
				</ErrorBoundary>
			)}
		</Suspense>
	)
}

/**
 * Fetches a dialog's chunk ahead of the click that opens it, so the click
 * doesn't wait on the network. Worth it where the dialog is one click away.
 */
export function prefetchGlobalDialog(dialogKey: GlobalDialogKey) {
	globalDialogs.get(dialogKey)?.load()
}
