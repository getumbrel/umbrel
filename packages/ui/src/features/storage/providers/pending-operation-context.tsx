import {createContext, ReactNode, useCallback, useContext, useState} from 'react'

import type {RaidProgress} from '../hooks/use-raid-progress'

type PendingRaidOperationContextType = {
	operationError: string | null
	setOperationError: (error: string | null) => void
	pendingOperation: RaidProgress | null
	setPendingOperation: (op: RaidProgress | null) => void
	clearPendingOperation: () => void
}

const PendingRaidOperationContext = createContext<PendingRaidOperationContextType | null>(null)

export function PendingRaidOperationProvider({children}: {children: ReactNode}) {
	const [operationError, setOperationError] = useState<string | null>(null)
	const [pendingOperation, updatePendingOperation] = useState<RaidProgress | null>(null)

	const setPendingOperation = useCallback((operation: RaidProgress | null) => {
		if (operation) setOperationError(null)
		updatePendingOperation(operation)
	}, [])
	const clearPendingOperation = useCallback(() => updatePendingOperation(null), [])

	return (
		<PendingRaidOperationContext
			value={{pendingOperation, setPendingOperation, clearPendingOperation, operationError, setOperationError}}
		>
			{children}
		</PendingRaidOperationContext>
	)
}

export function usePendingRaidOperation() {
	const context = useContext(PendingRaidOperationContext)
	if (!context) {
		throw new Error('usePendingRaidOperation must be used within PendingRaidOperationProvider')
	}
	return context
}
