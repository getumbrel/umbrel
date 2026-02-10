import {createContext, ReactNode, useCallback, useContext, useState} from 'react'

import {RaidProgress} from '../hooks/use-raid-progress'

type PendingRaidOperationContextType = {
	pendingOperation: RaidProgress | null
	setPendingOperation: (op: RaidProgress | null) => void
	clearPendingOperation: () => void
}

const PendingRaidOperationContext = createContext<PendingRaidOperationContextType | null>(null)

export function PendingRaidOperationProvider({children}: {children: ReactNode}) {
	const [pendingOperation, setPendingOperation] = useState<RaidProgress | null>(null)

	const clearPendingOperation = useCallback(() => setPendingOperation(null), [])

	return (
		<PendingRaidOperationContext.Provider value={{pendingOperation, setPendingOperation, clearPendingOperation}}>
			{children}
		</PendingRaidOperationContext.Provider>
	)
}

export function usePendingRaidOperation() {
	const context = useContext(PendingRaidOperationContext)
	if (!context) {
		throw new Error('usePendingRaidOperation must be used within PendingRaidOperationProvider')
	}
	return context
}
