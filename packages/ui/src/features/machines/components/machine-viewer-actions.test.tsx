// @vitest-environment jsdom
import {act, createRef} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, it, vi} from 'vitest'

import {MachineAgentOverlay} from './machine-agent-overlay'
import {MachineViewerActionsProvider, useMachineViewerActions} from './machine-viewer-actions'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('./agent-pointer', () => ({AgentPointer: () => null, agentVisualFor: () => ({})}))
vi.mock('./machine-agent-presence', () => ({MachineAgentPresence: () => null}))
vi.mock('@/routes/settings/mcp/constellation', () => ({AgentLogoPlate: () => null}))
it('routes a rail request straight to this console’s takeover; a console click still asks first', () => {
	;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
	const host = document.createElement('div'),
		root = createRoot(host),
		takeOver = vi.fn()
	let actions: ReturnType<typeof useMachineViewerActions>
	function Rail() {
		actions = useMachineViewerActions()
		return null
	}
	const ref = createRef<HTMLDivElement>()
	try {
		act(() =>
			root.render(
				<MachineViewerActionsProvider>
					<Rail />
					<MachineAgentOverlay
						machineId='one'
						agentControl={{agent: {tokenId: 'agent', label: 'Codex'}, sequence: 1, lastInputAt: 1, observedAt: 1}}
						takenOver={false}
						onTakeOver={takeOver}
						root={ref}
						screen={ref}
					/>
				</MachineViewerActionsProvider>,
			),
		)
		act(() => actions?.request('another'))
		expect(takeOver).not.toHaveBeenCalled()
		act(() => actions?.request('one'))
		expect(takeOver).toHaveBeenCalledOnce()
		expect(host.textContent).not.toContain('machines.console-agent-take-over-title')
		// Clicking the console itself still asks before handing over the controls
		const gate = host.querySelector<HTMLButtonElement>('button[aria-label="machines.console-agent-take-over"]')!
		act(() => gate.click())
		expect(host.textContent).toContain('machines.console-agent-take-over-title')
		expect(takeOver).toHaveBeenCalledOnce()
		const confirm = Array.from(host.querySelectorAll('button')).find(
			(button) => button.textContent === 'machines.console-agent-take-over',
		)!
		act(() => confirm.click())
		expect(takeOver).toHaveBeenCalledTimes(2)
	} finally {
		act(() => root.unmount())
	}
})
