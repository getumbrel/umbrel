import {createContext, useCallback, useContext, useMemo, useRef, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {useHomePath} from '@/features/files/hooks/use-home-path'
import {useItemClick} from '@/features/files/hooks/use-item-click'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import type {ViewPreferences} from '@/features/files/types'
import {formatLocation} from '@/features/files/utils/format-location'

type FileItemContextValue = {
	handleClick: ReturnType<typeof useItemClick>['handleClick']
	handleDoubleClick: ReturnType<typeof useItemClick>['handleDoubleClick']
	view: ViewPreferences['view'] | undefined
	// The width the grid gives each tile, in px
	gridItemWidth: number
	// The listing gathers items from all over (a search's results, Recents),
	// so each says where it lives instead of what kind of file it is
	showLocation: boolean
	// Where an item lives, as that listing says it: "Home › Documents"
	locationOf: (path: string) => string
}

const FileItemContext = createContext<FileItemContextValue | null>(null)

/**
 * What every row needs but shouldn't set up for itself: click handling (which
 * pulls in the file operations and their mutations), the view preference and
 * how a location is worded. A listing keeps a few dozen virtualised rows mounted and
 * cycles them on every scroll, so per-row copies of these hooks meant hundreds
 * of query and mutation observers and a refetch for each row that mounted.
 */
export function FileItemProvider({children, gridItemWidth = 128}: {children: ReactNode; gridItemWidth?: number}) {
	const {t} = useTranslation()
	const {preferences} = usePreferences()
	const {isBrowsingSearch, isBrowsingRecents} = useNavigate()
	const homePath = useHomePath()
	const locationOf = useCallback(
		(path: string) =>
			formatLocation(path, {
				homePath,
				labels: {
					home: t('files-sidebar.home'),
					apps: t('files-sidebar.apps'),
					machines: t('machines'),
					network: t('files-sidebar.network'),
					trash: t('files-sidebar.trash'),
				},
			}),
		[homePath, t],
	)

	// The click handlers are rebuilt on most renders (the operations behind
	// them follow the selection, the clipboard and where Files is), and every
	// row reads this context: handing them over as they are would render every
	// row each time anything was selected. They only ever run from a click, so
	// the rows get two that never change and call whatever the handlers are now.
	const itemClick = useItemClick()
	const latest = useRef(itemClick)
	latest.current = itemClick
	const handleClick = useCallback<FileItemContextValue['handleClick']>(
		(...args) => latest.current.handleClick(...args),
		[],
	)
	const handleDoubleClick = useCallback<FileItemContextValue['handleDoubleClick']>(
		(...args) => latest.current.handleDoubleClick(...args),
		[],
	)

	const view = preferences?.view
	const showLocation = isBrowsingSearch || isBrowsingRecents
	const value = useMemo(
		() => ({handleClick, handleDoubleClick, view, gridItemWidth, showLocation, locationOf}),
		[handleClick, handleDoubleClick, view, gridItemWidth, showLocation, locationOf],
	)

	return <FileItemContext value={value}>{children}</FileItemContext>
}

export function useFileItemContext() {
	const context = useContext(FileItemContext)
	if (!context) throw new Error('useFileItemContext must be used within FileItemProvider')
	return context
}
