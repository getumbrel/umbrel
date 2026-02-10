// Tracks when any ImmersiveDialog is open, allowing other components (like floating islands)
// to adjust their z-index to appear above the dialog.
//
// Uses a counter instead of boolean to handle edge cases robustly:
// - Nested dialogs (e.g., storage manager has sub-dialogs)
// - React StrictMode double-mounting
// - Complex component timing issues
// Only reports closed (isOpen=false) when ALL dialogs have closed.

import {createContext, ReactNode, useCallback, useContext, useState} from 'react'

interface ImmersiveDialogContextValue {
	isOpen: boolean
	increment: () => void
	decrement: () => void
}

const ImmersiveDialogContext = createContext<ImmersiveDialogContextValue | null>(null)

export function ImmersiveDialogProvider({children}: {children: ReactNode}) {
	const [count, setCount] = useState(0)
	const increment = useCallback(() => setCount((c) => c + 1), [])
	const decrement = useCallback(() => setCount((c) => Math.max(0, c - 1)), [])
	const isOpen = count > 0
	return (
		<ImmersiveDialogContext.Provider value={{isOpen, increment, decrement}}>{children}</ImmersiveDialogContext.Provider>
	)
}

export function useImmersiveDialogOpen() {
	const ctx = useContext(ImmersiveDialogContext)
	if (!ctx) throw new Error('useImmersiveDialogOpen must be used within ImmersiveDialogProvider')
	return ctx.isOpen
}

export function useImmersiveDialogCounter() {
	const ctx = useContext(ImmersiveDialogContext)
	if (!ctx) throw new Error('useImmersiveDialogCounter must be used within ImmersiveDialogProvider')
	return {increment: ctx.increment, decrement: ctx.decrement}
}
