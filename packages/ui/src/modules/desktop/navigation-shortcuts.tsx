import {useEffect} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'

import {useCmdkOpen} from '@/components/cmdk'
import {getLastFilesPath} from '@/features/files/utils/last-files-path'
import {useQueryParams} from '@/hooks/use-query-params'
import {systemAppsKeyed} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

const NAV_SHORTCUTS = {
	files: 'f',
	photos: 'p',
	appStore: 'a',
	machines: 'm',
	settings: 's',
	liveUsage: 'l',
	home: 'h',
} as const

/**
 * Global Alt/Option+letter shortcuts that mirror the dock: ⌥F Files,
 * ⌥P Photos, ⌥A App Store, ⌥M Machines, ⌥S Settings, ⌥L Live Usage,
 * ⌥H Home.
 *
 * Only bare Alt combos are claimed — Cmd/Ctrl/Shift variants (including
 * AltGr, which browsers report as Ctrl+Alt) stay with the browser and OS.
 * Keys landing in editable elements pass through untouched because
 * Option+letter is how macOS types special characters, and keys typed into
 * a focused VM console never reach us at all: noVNC stops propagation of
 * every key it forwards to the guest.
 */
export function NavigationShortcuts() {
	const navigate = useNavigate()
	const {pathname} = useLocation()
	const {params} = useQueryParams()
	const linkToDialog = useLinkToDialog()
	const {open: cmdkOpen} = useCmdkOpen()

	const {data: user} = trpcReact.user.get.useQuery()
	const userId = user?.userId
	const isOwner = user?.role === 'owner'

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
			if (e.repeat || e.isComposing || e.defaultPrevented || cmdkOpen) return

			const target = e.target instanceof Element ? e.target : null
			if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return

			// macOS reports Option+letter as the typed special character
			// (Option+F is "ƒ"), so fall back from the printed key to the
			// physical key position to recover the letter
			const printed = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : null
			const physical = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : null
			const letter = printed ?? physical
			if (!letter) return

			// Each shortcut navigates exactly like its dock item. `null` means
			// the destination is already open: the press is still consumed so
			// the browser's own Alt menus don't grab it, but nothing new is
			// pushed onto the history stack.
			const actions: Record<string, (() => void) | null | undefined> = {
				// Files reopens where the user left off, same as the dock icon
				[NAV_SHORTCUTS.files]: pathname.startsWith('/files')
					? null
					: () => navigate(getLastFilesPath(userId) || systemAppsKeyed['UMBREL_files'].systemAppTo),
				[NAV_SHORTCUTS.photos]: pathname.startsWith(systemAppsKeyed['UMBREL_photos'].systemAppTo)
					? null
					: () => navigate(systemAppsKeyed['UMBREL_photos'].systemAppTo),
				[NAV_SHORTCUTS.appStore]:
					pathname.startsWith(systemAppsKeyed['UMBREL_app-store'].systemAppTo) ||
					pathname.startsWith('/community-app-store')
						? null
						: () => navigate(systemAppsKeyed['UMBREL_app-store'].systemAppTo),
				// The dock hides Machines from members, so the shortcut skips them too
				[NAV_SHORTCUTS.machines]: !isOwner
					? undefined
					: pathname.startsWith(systemAppsKeyed['UMBREL_machines'].systemAppTo)
						? null
						: () => navigate(systemAppsKeyed['UMBREL_machines'].systemAppTo),
				[NAV_SHORTCUTS.settings]: pathname.startsWith(systemAppsKeyed['UMBREL_settings'].systemAppTo)
					? null
					: () => navigate(systemAppsKeyed['UMBREL_settings'].systemAppTo),
				[NAV_SHORTCUTS.liveUsage]:
					params.get('dialog') === 'live-usage' ? null : () => navigate(linkToDialog('live-usage')),
				// Home also closes whichever url-driven dialog is up, since
				// navigating clears the dialog search params
				[NAV_SHORTCUTS.home]: pathname === '/' && !params.get('dialog') ? null : () => navigate('/'),
			}

			const action = actions[letter]
			if (action === undefined) return
			e.preventDefault()
			action?.()
		}

		document.addEventListener('keydown', handler)
		return () => document.removeEventListener('keydown', handler)
	}, [pathname, params, linkToDialog, navigate, userId, isOwner, cmdkOpen])

	return null
}
