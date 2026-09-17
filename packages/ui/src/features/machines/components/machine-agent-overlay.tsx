import {useEffect, useRef, useState, type RefObject} from 'react'
import {useTranslation} from 'react-i18next'

import {AgentPointer, agentVisualFor} from '@/features/machines/components/agent-pointer'
import type {MachineAgentControl} from '@/features/machines/types'
import {AgentLogoPlate} from '@/routes/settings/mcp/constellation'

import {MachineAgentPresence} from './machine-agent-presence'
import {useMachineViewerActions} from './machine-viewer-actions'

export function MachineAgentOverlay({
	machineId,
	animateArrival = false,
	agentControl,
	takenOver,
	onTakeOver,
	root,
	screen,
}: {
	machineId: string
	animateArrival?: boolean
	agentControl: MachineAgentControl
	takenOver: boolean
	onTakeOver: () => void
	root: RefObject<HTMLDivElement | null>
	screen: RefObject<HTMLDivElement | null>
}) {
	const {t} = useTranslation()
	const [takeOverPrompt, setTakeOverPrompt] = useState(false)
	const viewerActions = useMachineViewerActions()
	const takeOver = useRef(onTakeOver)
	takeOver.current = onTakeOver
	useEffect(() => {
		// A rail request comes from an explicit "Take over" button, so it is
		// already the confirmation; only clicks on the console itself ask first
		if (!takenOver)
			return viewerActions?.register(machineId, () => {
				setTakeOverPrompt(false)
				takeOver.current()
			})
	}, [machineId, takenOver, viewerActions])
	const agentOwned = !takenOver
	const agentName = agentControl.agent.label
	return (
		<>
			{agentOwned && (
				// Sits above the canvas so hovering never reaches noVNC and a click
				// asks before handing the viewer the controls. A button so keyboard
				// users can reach the prompt too.
				<button
					type='button'
					className='absolute inset-0 z-10 cursor-none rounded-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-hidden focus-visible:ring-inset'
					aria-label={t('machines.console-agent-take-over')}
					onClick={() => setTakeOverPrompt(true)}
				/>
			)}
			<AgentPointer key={agentControl.agent.tokenId} control={agentControl} root={root} screen={screen} />

			<MachineAgentPresence control={agentControl} takenOver={takenOver} animateArrival={animateArrival} />

			{agentOwned && takeOverPrompt && (
				<div className='absolute inset-0 z-30 flex cursor-auto items-center justify-center bg-black/60 backdrop-blur-sm'>
					<div className='flex max-w-sm flex-col items-center gap-4 px-6 text-center text-white'>
						<AgentLogoPlate agent={agentVisualFor(agentControl)} size={40} />
						<p className='text-15 font-medium'>{t('machines.console-agent-take-over-title', {agent: agentName})}</p>
						<p className='text-13 text-white/60'>{t('machines.console-agent-take-over-message')}</p>
						<div className='flex gap-2'>
							<button
								type='button'
								className='rounded-full bg-white/10 px-4 py-2 text-13 font-medium text-white transition-opacity hover:opacity-80'
								onClick={() => setTakeOverPrompt(false)}
							>
								{t('machines.console-agent-keep-watching')}
							</button>
							<button
								type='button'
								className='rounded-full bg-white px-4 py-2 text-13 font-medium text-black transition-opacity hover:opacity-80'
								onClick={() => {
									setTakeOverPrompt(false)
									onTakeOver()
								}}
							>
								{t('machines.console-agent-take-over')}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	)
}
