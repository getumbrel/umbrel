// This FilesCapabilities Context is a centralized configuration for the Files feature.
// It allows us to embed the Files UI (e.g., in Rewind feature) without relying on the router
// It allows us to configure the Files UI to be "read-only" and disable certain features like:
// DnD, Keyboard shortcuts, Context menu, File upload drop zone, File viewer, Search, View toggle
// and also allows us to hide or disable certain sidebar items like Network, External, Trash, Rewind

import React, {createContext, useContext, useMemo} from 'react'

export type FilesMode = 'full' | 'read-only'

export type FilesCapabilities = {
	// Controls read/write behavior and which UI elements are interactive.
	// 'full' enables interactions; 'read-only' disables operations, DnD, etc.
	mode: FilesMode
	// Optional: current logical path when embedding the Files UI.
	// If omitted, the router-driven path is used.
	currentPath?: string
	// Optional: navigation callback when embedding. If provided, the Files UI
	// will call this instead of pushing to the router.
	onNavigate?: (path: string) => void
	// Optional: logical→physical path remapping. Useful for Rewind feature where
	// logical roots like "/Home" map to "/Backups/<dir>/Home".
	pathAliases?: Record<string, string>
	// Optional: hide specific sidebar sections for focused embedded flows.
	hiddenSidebarItems?: {
		network?: boolean
		external?: boolean
		trash?: boolean
		rewind?: boolean
	}
}

const defaultCapabilities: FilesCapabilities = {
	mode: 'full',
}

const FilesCapabilitiesContext = createContext<FilesCapabilities>(defaultCapabilities)

export function FilesCapabilitiesProvider({
	children,
	value,
}: {
	children: React.ReactNode
	value?: Partial<FilesCapabilities>
}) {
	const computed = useMemo<FilesCapabilities>(() => {
		return {
			...defaultCapabilities,
			...(value || {}),
		}
	}, [value])

	return <FilesCapabilitiesContext.Provider value={computed}>{children}</FilesCapabilitiesContext.Provider>
}

// Read the current Files capabilities configuration.
export function useFilesCapabilities() {
	return useContext(FilesCapabilitiesContext)
}

// Convenience helper: true when Files is configured as read‑only.
export function useIsFilesReadOnly() {
	return useFilesCapabilities().mode === 'read-only'
}

// Convenience helper: true when Files is being embedded (not router-driven).
export function useIsFilesEmbedded() {
	const {currentPath, onNavigate} = useFilesCapabilities()
	return Boolean(currentPath || onNavigate)
}
