import React, {createContext, useContext, useState, type ComponentType} from 'react'

// Something the current listing lets you do to the folder itself: upload into
// it, make a folder in it, empty it. The listing describes them once and every
// surface draws from the same list: the bar's pills on a desktop, the + menu
// on a phone and the menu on empty space.
export type BarAction = {
	id: string
	label: string
	icon: ComponentType<{className?: string}>
	onSelect: () => void
	disabled?: boolean
	// A pill of its own in the desktop bar, under this shorter name where one fits better
	pill?: string | true
	// Shown beside the item in menus that are opened with a keyboard nearby
	shortcut?: string
	// Left out of the phone's + menu (it has a place of its own there)
	desktopOnly?: boolean
}

// What a listing holds, for the line under the bar's title
export type ListingSummary = {
	count?: number
	// The listing stopped counting here: "10,000+ items"
	truncatedAt?: number
	size?: number | null
	// Results of a search, counted as results rather than items
	isSearch?: boolean
}

// Configuration options that influence the behaviour and rendering of the
// global <ActionsBar /> component. A listing component (e.g. DirectoryListing,
// TrashListing, etc.) updates the configuration every time it mounts or when
// the relevant values change (e.g. when listing state transitions from
// loading to error or back).
export interface ActionsBarConfig {
	// Whether to hide the path
	hidePath?: boolean

	// Whether to hide the search input
	hideSearch?: boolean

	// What can be done to the folder itself
	actions?: BarAction[]

	// Whether what it lists can be selected (the cloud account tiles can't)
	selectable?: boolean

	// The page is not a listing of files, so it has no list or icons to switch between
	hideViewOptions?: boolean
}

interface ActionsBarContextValue {
	// Current configuration
	config: ActionsBarConfig
	// Update the configuration
	setConfig: (config: ActionsBarConfig) => void
	// What the listing on screen holds, which <Listing /> itself reports
	summary: ListingSummary | undefined
	setSummary: (summary: ListingSummary | undefined) => void
}

const ActionsBarContext = createContext<ActionsBarContextValue | undefined>(undefined)

export function ActionsBarProvider({children}: {children: React.ReactNode}) {
	// We intentionally keep the initial config minimal.  Each listing sets the
	// configuration on mount.
	const [config, setConfig] = useState<ActionsBarConfig>({})
	const [summary, setSummary] = useState<ListingSummary>()

	return <ActionsBarContext value={{config, setConfig, summary, setSummary}}>{children}</ActionsBarContext>
}

// Convenience hook used by <ActionsBar /> to access the current config.
export function useActionsBarConfig() {
	const ctx = useContext(ActionsBarContext)
	if (!ctx) {
		throw new Error('useActionsBarConfig must be used within an <ActionsBarProvider />')
	}
	return {...ctx.config, summary: ctx.summary}
}

// Hook for listings to update the configuration.
export function useSetActionsBarConfig() {
	const ctx = useContext(ActionsBarContext)
	if (!ctx) {
		throw new Error('useSetActionsBarConfig must be used within an <ActionsBarProvider />')
	}
	return ctx.setConfig
}

// Hook for <Listing /> to say what it holds.
export function useSetListingSummary() {
	const ctx = useContext(ActionsBarContext)
	if (!ctx) {
		throw new Error('useSetListingSummary must be used within an <ActionsBarProvider />')
	}
	return ctx.setSummary
}
