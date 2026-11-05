import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {useNavigate} from 'react-router-dom'

import {MachineAgentOverlay} from '@/features/machines/components/machine-agent-overlay'
import {machineIconSrc} from '@/features/machines/components/os-icon'
import {MACHINES_PATH} from '@/features/machines/constants'
import {useConsoleAgent} from '@/features/machines/hooks/use-console-agent'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachineAudio} from '@/features/machines/hooks/use-machine-audio'
import {useMachineAudioPreference} from '@/features/machines/hooks/use-machine-audio-preference'
import type {Machine} from '@/features/machines/types'
import {t} from '@/utils/i18n'

import {RfbGuest} from './rfb-guest'
import {currentDisplay, desktopFor, TouchConsole} from './touch-console'

// While it's open the console owns the glass: the page can't zoom or scroll under
// a finger, and it gets the whole screen to lay out in, safe areas and all
function useConsoleDocument() {
	useEffect(() => {
		const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
		const content = viewport?.content
		viewport?.setAttribute('content', `${content}, user-scalable=no, viewport-fit=cover`)
		// Browsers tint their bars with this, and it otherwise follows the wallpaper
		const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
		const wallpaperColor = theme?.content
		theme?.setAttribute('content', '#000000')
		document.documentElement.classList.add('machine-console-open')
		// Safari still zooms the page on a pinch that starts on nothing in particular
		const stopPageZoom = (event: Event) => event.preventDefault()
		document.addEventListener('gesturestart', stopPageZoom)
		return () => {
			if (content) viewport?.setAttribute('content', content)
			if (wallpaperColor) theme?.setAttribute('content', wallpaperColor)
			document.documentElement.classList.remove('machine-console-open')
			document.removeEventListener('gesturestart', stopPageZoom)
		}
	}, [])
}

// The touch console, on a real machine. It covers the whole screen, outside the
// Machines window and its transforms; `children` is whatever has to show over it.
export default function TouchMachineConsole({
	machine,
	resizeSession,
	textConsole,
	children,
}: {
	machine: Machine
	resizeSession: boolean
	textConsole: boolean
	children: ReactNode
}) {
	useConsoleDocument()
	const root = useRef<HTMLDivElement>(null)
	const navigate = useNavigate()
	const {stop, restart} = useMachineActions()
	const {muted, setMuted} = useMachineAudioPreference(machine.id)

	const guest = useMemo(
		() =>
			new RfbGuest(machine.id, {
				family: machine.osId === 'android' ? 'android' : machine.osId.startsWith('windows') ? 'windows' : 'linux',
				nativeTouch: machine.osId === 'android',
				textOnly: textConsole,
				omarchy: machine.osId === 'omarchy',
				desiredSize: resizeSession ? desktopFor(currentDisplay()) : undefined,
			}),
		[machine.id],
	)

	const [status, setStatus] = useState(guest.status)
	useEffect(() => guest.onStatus(() => setStatus(guest.status)), [guest])
	useMachineAudio({
		machineId: machine.id,
		sessionId: guest.sessionId,
		live: status === 'connected',
		muted,
		gestureTarget: root,
	})

	const {agentControl, arrivalToken, takenOver, takeOver, agentOwned} = useConsoleAgent(machine.id)
	useEffect(() => guest.setViewOnly(agentOwned), [agentOwned, guest])

	return createPortal(
		<div ref={root}>
			<TouchConsole
				key={machine.id}
				guest={guest}
				title={machine.name}
				subtitle={`${t('machines.cores-count', {count: machine.cores})} · ${t('machines.gb', {value: machine.memoryGb})}`}
				icon={machineIconSrc(machine.osId, 'on')}
				muted={muted}
				onMuted={setMuted}
				watching={agentOwned}
				onLeave={() => navigate(MACHINES_PATH)}
				onPower={(action) => (action === 'restart' ? restart({id: machine.id}) : stop({id: machine.id}))}
				onScreen={({stage, layer}) =>
					agentControl && (
						<MachineAgentOverlay
							key={agentControl.agent.tokenId}
							machineId={machine.id}
							animateArrival={arrivalToken === agentControl.agent.tokenId}
							agentControl={agentControl}
							takenOver={takenOver}
							root={stage}
							screen={layer}
							onTakeOver={takeOver}
						/>
					)
				}
			>
				{children}
			</TouchConsole>
		</div>,
		document.body,
	)
}
