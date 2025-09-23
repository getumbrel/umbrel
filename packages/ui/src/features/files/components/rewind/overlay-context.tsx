import React, {createContext, useContext, useState} from 'react'

type RewindOverlayContextValue = {
	overlayOpen: boolean
	setOverlayOpen: (v: boolean) => void
	repoOpen: boolean
	setRepoOpen: (v: boolean) => void
}

const Ctx = createContext<RewindOverlayContextValue | null>(null)

export function RewindOverlayProvider({children}: {children: React.ReactNode}) {
	const [overlayOpen, setOverlayOpen] = useState(false)
	const [repoOpen, setRepoOpen] = useState(false)
	return <Ctx.Provider value={{overlayOpen, setOverlayOpen, repoOpen, setRepoOpen}}>{children}</Ctx.Provider>
}

export function useRewindOverlay() {
	const ctx = useContext(Ctx)
	if (!ctx) throw new Error('useRewindOverlay must be used within RewindOverlayProvider')
	return ctx
}
