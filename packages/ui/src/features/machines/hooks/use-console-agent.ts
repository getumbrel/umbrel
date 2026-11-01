import {useCallback, useEffect, useState} from 'react'

import {useMachineAgentControls} from '@/features/machines/hooks/use-machines'

// An agent driving this machine, and whether the person watching has taken over
export function useConsoleAgent(machineId: string) {
	const [arrivalToken, setArrivalToken] = useState<string>()
	const agentControl = useMachineAgentControls({
		onArrival: (id, token) => {
			if (id === machineId) setArrivalToken(token)
		},
	})[machineId]
	const [takenOver, setTakenOver] = useState(false)

	// A take-over lasts for the agent's turn; the next agent starts watched again
	useEffect(() => {
		if (agentControl) return
		setArrivalToken(undefined)
		setTakenOver(false)
	}, [agentControl])

	const takeOver = useCallback(() => setTakenOver(true), [])
	return {agentControl, arrivalToken, takenOver, takeOver, agentOwned: !!agentControl && !takenOver}
}
