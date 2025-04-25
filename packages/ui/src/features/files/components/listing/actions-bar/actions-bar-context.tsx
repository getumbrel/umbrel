import React, {createContext, useContext, useState} from 'react'

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

	// Additional buttons displayed on desktop resolutions (≥ md breakpoint)
	// eg. "New Folder", "Upload", "Empty Trash", etc.
	desktopActions?: React.ReactNode

	// Additional dropdown items displayed on mobile resolutions (< md breakpoint)
	mobileActions?: React.ReactNode
}

interface ActionsBarContextValue {
	// Current configuration
	config: ActionsBarConfig
	// Update the configuration
	setConfig: (config: ActionsBarConfig) => void
}

const ActionsBarContext = createContext<ActionsBarContextValue | undefined>(undefined)

export function ActionsBarProvider({children}: {children: React.ReactNode}) {
	// We intentionally keep the initial config minimal.  Each listing sets the
	// configuration on mount.
	const [config, setConfig] = useState<ActionsBarConfig>({})

	return <ActionsBarContext.Provider value={{config, setConfig}}>{children}</ActionsBarContext.Provider>
}

// Convenience hook used by <ActionsBar /> to access the current config.
export function useActionsBarConfig() {
	const ctx = useContext(ActionsBarContext)
	if (!ctx) {
		throw new Error('useActionsBarConfig must be used within an <ActionsBarProvider />')
	}
	return ctx.config
}

// Hook for listings to update the configuration.
export function useSetActionsBarConfig() {
	const ctx = useContext(ActionsBarContext)
	if (!ctx) {
		throw new Error('useSetActionsBarConfig must be used within an <ActionsBarProvider />')
	}
	return ctx.setConfig
}
