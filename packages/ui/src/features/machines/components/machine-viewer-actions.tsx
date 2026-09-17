import {createContext, useContext, useMemo, useRef, type ReactNode} from 'react'

// Scoped to the open Machines view; no global events or cross-tab takeover.
const ViewerActions = createContext<{
	register: (machineId: string, action: () => void) => () => void
	request: (machineId: string) => void
} | null>(null)
export function MachineViewerActionsProvider({children}: {children: ReactNode}) {
	const handlers = useRef(new Map<string, () => void>())
	const value = useMemo(
		() => ({
			register: (id: string, action: () => void) => {
				handlers.current.set(id, action)
				return () => {
					if (handlers.current.get(id) === action) handlers.current.delete(id)
				}
			},
			request: (id: string) => handlers.current.get(id)?.(),
		}),
		[],
	)
	return <ViewerActions.Provider value={value}>{children}</ViewerActions.Provider>
}
export const useMachineViewerActions = () => useContext(ViewerActions)
