import {useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {AnimatedHeight} from '@/components/ui/animated-height'
import {Button} from '@/components/ui/button'
import {Dialog, DialogDescription, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Loading} from '@/components/ui/loading'
import {MachineAccessDetail} from '@/routes/settings/mcp/access'
import {matchAgent, MCP_AGENTS, OTHER_AGENT} from '@/routes/settings/mcp/agents'
import {ConnectView} from '@/routes/settings/mcp/connect'
import {AgentLogoPlate} from '@/routes/settings/mcp/constellation'
import {IntroView} from '@/routes/settings/mcp/intro'
import {McpStatusCard} from '@/routes/settings/mcp/status-card'

import type {Machine, MachineAgentControl} from '../../types'
import {agentVisualFor} from '../agent-pointer'
import {OsIcon} from '../os-icon'
import {MachineAgentPreview} from './machine-agent-preview'
import {machineAgentState} from './model'
import {useAgentAccess} from './use-agent-access'

export function MachineAgentDialog({
	machine,
	open,
	onOpenChange,
	control,
	onTakeOver,
}: {
	machine: Machine
	open: boolean
	onOpenChange: (open: boolean) => void
	control?: MachineAgentControl
	onTakeOver: () => void
}) {
	const c = useAgentAccess(machine.id, open)
	const {t} = useTranslation()
	const [step, setStep] = useState<'main' | 'picker' | 'connect' | 'manage'>('main')
	// The view stays mounted between openings so a freshly created token
	// survives; the step does not, or closing from "manage" reopens there
	const [wasOpen, setWasOpen] = useState(open)
	if (open !== wasOpen) {
		setWasOpen(open)
		if (open) setStep('main')
	}
	// Radix traps focus while the dialog is mounted and returns it to the rail
	// button on unmount, so the console can only take focus once that is done
	const closingForTakeOver = useRef(false)
	const settings = c.settings
	const state = settings && c.tokens ? machineAgentState(settings, c.tokens, machine.id, control) : undefined
	const activeToken = c.tokens?.find((token) => token.id === c.credential?.id)
	const connected = c.tokens?.filter((token) => token.lastRequestAt !== null) ?? []
	const finish = () => {
		if (activeToken?.lastRequestAt != null) c.clearCredential()
		setStep('main')
	}
	const startConnection = () => setStep(c.credential ? 'connect' : 'picker')
	const pending = c.busy || (step === 'connect' && c.appsLoading)
	let content
	if (c.loading || (!state && !c.loadError))
		content = (
			<div className='grid place-items-center py-16'>
				<Loading />
			</div>
		)
	else if (c.loadError)
		content = (
			<div className='space-y-4 text-center'>
				<p>{t('mcp-load-failed')}</p>
				<Button onClick={c.retry}>{t('try-again')}</Button>
			</div>
		)
	else if (pending && (step === 'picker' || step === 'connect'))
		content = <McpStatusCard phase='enabling' enablingLabel={t('mcp-creating-token')} />
	else if (step === 'picker')
		content = (
			<div className='space-y-4'>
				<button className='text-13 text-white/60 hover:text-white' onClick={() => setStep('main')}>
					{t('back')}
				</button>
				<IntroView
					defaultView='picker'
					connecting={c.busy}
					onSelect={async (agent) => {
						if (await c.connect(agent)) setStep('connect')
					}}
				/>
			</div>
		)
	else if (step === 'connect' && c.credential)
		content = (
			<ConnectView
				token={c.credential.token}
				url={`http://${window.location.host}/mcp`}
				installedAppIds={c.apps}
				initialAgent={c.credential.agent}
				lastRequestAt={activeToken?.lastRequestAt ?? null}
				client={activeToken?.clients[0] ?? null}
				onDone={finish}
			/>
		)
	else if (step === 'manage' && settings)
		content = c.machinesLoading ? (
			<div className='grid place-items-center py-12'>
				<Loading />
			</div>
		) : c.machinesError ? (
			<div className='space-y-3'>
				<p>{t('mcp-load-failed')}</p>
				<Button onClick={c.retry}>{t('try-again')}</Button>
			</div>
		) : (
			<MachineAccessDetail
				permissions={settings.permissions}
				machines={c.machines}
				busy={c.busy}
				onUpdate={(patch) => {
					void c.updatePermissions(patch)
				}}
				onBack={() => setStep('main')}
			/>
		)
	else
		content = (
			<div className='space-y-5'>
				<div className='flex items-center gap-3'>
					<OsIcon osId={machine.osId} state={machine.state} className='size-11' />
					<div className='min-w-0'>
						<p className='text-12 text-white/45'>{t('machines.agents.label')}</p>
						<h2 className='truncate text-17 font-semibold'>{machine.name}</h2>
					</div>
				</div>
				{(state === 'off' || state === 'connection') && <MachineAgentPreview />}
				{state === 'active' && control ? (
					<div className='flex flex-col items-center gap-3 py-3 text-center'>
						<AgentLogoPlate agent={agentVisualFor(control)} size={48} />
						<h3 className='text-19 font-semibold'>
							{t('machines.console-agent-controlling', {agent: control.agent.label})}
						</h3>
						<p className='text-13 text-white/60'>{t('machines.agents.active-description')}</p>
					</div>
				) : (
					<div className='space-y-2'>
						<h3 className='text-19 font-semibold -tracking-2'>
							{state === 'ready'
								? t('machines.agents.ready-title')
								: state === 'access'
									? t('machines.agents.access-title')
									: state === 'connection'
										? t('machines.agents.connection-title')
										: t('machines.agents.intro-title')}
						</h3>
						<p className='text-13 leading-relaxed text-white/60'>
							{state === 'ready'
								? t('machines.agents.ready-description')
								: state === 'access'
									? t('machines.agents.access-description')
									: state === 'connection'
										? t('machines.agents.connection-description')
										: t('machines.agents.intro-description')}
						</p>
					</div>
				)}
				{connected.length > 0 && state !== 'off' && (
					<div className='flex flex-wrap gap-2'>
						{connected.map((token) => (
							<span
								key={token.id}
								className='flex items-center gap-2 rounded-full bg-white/5 py-1.5 pr-3 pl-1.5 text-12 text-white/75'
							>
								<AgentLogoPlate
									agent={
										MCP_AGENTS.find((agent) => agent.id === token.agentType) ??
										matchAgent(token.clients[0]?.name) ??
										OTHER_AGENT
									}
									size={22}
								/>
								{token.label}
							</span>
						))}
					</div>
				)}
				{machine.state !== 'running' && <p className='text-12 text-white/50'>{t('machines.agents.start-machine')}</p>}
				<div className='flex flex-col gap-3'>
					{state === 'off' && (c.tokens?.length ?? 0) > 0 ? (
						<>
							<p className='text-12 text-white/50'>{t('machines.agents.resume-description')}</p>
							<Button
								size='lg'
								disabled={c.busy}
								onClick={() => {
									void c.resume()
								}}
							>
								{t('machines.agents.resume')}
							</Button>
						</>
					) : state === 'off' || state === 'connection' ? (
						<>
							<Button size='lg' disabled={c.busy} onClick={startConnection}>
								{state === 'off'
									? t('machines.agents.connect')
									: c.credential
										? t('machines.agents.finish-connecting')
										: t('machines.agents.new-instructions')}
							</Button>
							{state === 'connection' && !c.credential && (
								<p className='text-12 leading-relaxed text-white/40'>{t('machines.agents.instructions-description')}</p>
							)}
						</>
					) : state === 'access' ? (
						<Button
							size='lg'
							disabled={c.busy}
							onClick={() => {
								void c.grant()
							}}
						>
							{t('machines.agents.allow-access')}
						</Button>
					) : state === 'active' ? (
						<Button
							size='lg'
							disabled={machine.state !== 'running'}
							onClick={() => {
								closingForTakeOver.current = true
								onOpenChange(false)
							}}
						>
							{t('machines.console-agent-take-over')}
						</Button>
					) : (
						<Button size='lg' onClick={() => onOpenChange(false)}>
							{t('machines.agents.back-console')}
						</Button>
					)}
					{(state === 'ready' || state === 'active' || state === 'access') && (
						<button
							disabled={c.busy}
							className='text-13 text-white/50 hover:text-white disabled:opacity-40'
							onClick={startConnection}
						>
							{t('machines.agents.connect-another')}
						</button>
					)}
					{settings?.enabled && (
						<button
							disabled={c.busy}
							className='text-13 text-white/50 hover:text-white disabled:opacity-40'
							onClick={() => setStep('manage')}
						>
							{t('machines.agents.manage-access')}
						</button>
					)}
				</div>
			</div>
		)
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!c.busy) onOpenChange(value)
			}}
		>
			<DialogScrollableContent
				showClose
				className='sm:max-w-[500px]'
				onCloseAutoFocus={(event) => {
					if (!closingForTakeOver.current) return
					closingForTakeOver.current = false
					event.preventDefault()
					onTakeOver()
				}}
			>
				<DialogTitle className='sr-only'>{t('machines.agents.dialog-title', {name: machine.name})}</DialogTitle>
				<DialogDescription className='sr-only'>{t('machines.agents.intro-title')}</DialogDescription>
				<div className='px-5 pt-8 pb-6'>
					<AnimatedHeight contentClassName='relative'>{content}</AnimatedHeight>
					{c.error && (
						<p role='alert' className='mt-4 text-13 text-red-300'>
							{t('machines.agents.save-error')}
						</p>
					)}
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}
