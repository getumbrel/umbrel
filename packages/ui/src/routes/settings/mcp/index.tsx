import {formatDistanceStrict} from 'date-fns'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useInterval} from 'react-use'

import {AnimatedHeight} from '@/components/ui/animated-height'
import {BetaPill} from '@/components/ui/beta-pill'
import {Button} from '@/components/ui/button'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/components/ui/drawer'
import {listClass} from '@/components/ui/list'
import {Loading} from '@/components/ui/loading'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {machineIconSrc} from '@/features/machines/components/os-icon'
import {useMachineCapabilities, useMachines} from '@/features/machines/hooks/use-machines'
import type {Machine} from '@/features/machines/types'
import {useIsPhone} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {AnimatedRow, GrantSummary, RowChevron, RowRemoveButton} from '@/modules/user-sharing'
import {isStorageCategoryPath} from '@/modules/user-sharing/new-user-access'
import {useConfirmation} from '@/providers/confirmation'
import {BackButton, SectionLabel, useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {
	AppAccessDetail,
	FileAccessDetail,
	MachineAccessDetail,
	type InstalledApp,
	type McpPermissions,
} from '@/routes/settings/mcp/access'
import {matchAgent, MCP_AGENTS, OTHER_AGENT, type McpAgentId} from '@/routes/settings/mcp/agents'
import {ConnectView} from '@/routes/settings/mcp/connect'
import {AgentLogoPlate} from '@/routes/settings/mcp/constellation'
import {IntroView} from '@/routes/settings/mcp/intro'
import {McpStatusCard} from '@/routes/settings/mcp/status-card'
import {RouterOutput, trpcReact} from '@/trpc/trpc'
import {languageCodeToDateLocale} from '@/utils/date-time'
import {t} from '@/utils/i18n'

type McpToken = RouterOutput['mcp']['listTokens'][number]
type McpCredential = {id: string; token: string}

// Maps raw backend bracketed error codes to user-friendly translated messages,
// following the files error-message convention (getFilesErrorMessage). Unknown
// codes fall back to the raw message.
function getMcpErrorMessage(message: string): string {
	if (message.includes('[already-enabled]')) return t('mcp-error.already-enabled')
	if (message.includes('[not-enabled]')) return t('mcp-error.not-enabled')
	if (message.includes('[token-limit]')) return t('mcp-error.token-limit')
	if (message.includes('[token-not-found]')) return t('mcp-error.token-not-found')
	if (message.includes('[app-not-installed]')) return t('mcp-error.app-not-installed')
	if (message.includes('[machine-not-found]')) return t('mcp-error.machine-not-found')
	if (message.includes('[invalid-base]')) return t('mcp-error.invalid-base')
	if (message.includes('[does-not-exist]') || message.includes('[not-a-directory]'))
		return t('mcp-error.folder-not-found')
	return message
}

// Settings → MCP. Owner-only dialog whose moments flow into one another: the
// first-run pitch (agents orbiting the umbrel) morphs into the agent picker,
// picking a tile opens the permission grants so the agent's access is settled
// before it ever gets a token, continuing collapses the dialog into the status
// card while the token is minted, the connect ceremony expands around that
// same card, and the enabled steady state is simply the permission grants.
// Every transition crossfades while the body height glides — the cloud wizard
// treatment.
export default function McpDialog() {
	const {t} = useTranslation()
	const isPhone = useIsPhone()
	const reducedMotion = useReducedMotion() ?? false
	const dialogProps = useSettingsDialogProps()
	const utils = trpcReact.useUtils()
	const confirm = useConfirmation()

	// Polled so the connect ceremony's waiting→connected flip lands within
	// moments of the agent's first authenticated request
	const settingsQ = trpcReact.mcp.getSettings.useQuery(undefined, {refetchInterval: 5000})
	const tokensQ = trpcReact.mcp.listTokens.useQuery(undefined, {refetchInterval: 5000})
	const settings = settingsQ.data
	const permissions = settings?.permissions
	const tokens = tokensQ.data ?? []

	const [view, setView] = useState<'main' | 'apps' | 'files' | 'machines'>('main')

	// The token is only returned when it is created and never persisted or
	// re-fetchable — same principle as the created-member-password view in users.tsx.
	const [revealedCredential, setRevealedCredential] = useState<McpCredential | null>(null)

	// Which agent tile the user picked in the intro; the connect view opens
	// already tailored to it.
	const [selectedAgent, setSelectedAgent] = useState<McpAgentId | 'generic'>('claude-code')

	// The agent picked on first run while its permissions are being chosen —
	// MCP stays off and no token exists until the user continues past them
	const [setupAgent, setSetupAgent] = useState<McpAgentId | 'generic' | null>(null)

	const revealToken = (credential: McpCredential) => {
		setRevealedCredential(credential)
		setSetupAgent(null)
		setView('main')
		utils.mcp.getSettings.invalidate()
		utils.mcp.listTokens.invalidate()
	}
	const toastError = (error: {message: string}) =>
		toast.error(t('mcp-error', {message: getMcpErrorMessage(error.message)}))

	const enableMut = trpcReact.mcp.enable.useMutation({
		onSuccess: (credential) => {
			if (credential) revealToken(credential)
			else {
				utils.mcp.getSettings.invalidate()
				utils.mcp.listTokens.invalidate()
			}
		},
		onError: toastError,
	})
	// Turning MCP off closes the dialog — landing the user back on the intro
	// pitch right after they said no would read as a sales push
	const disableMut = trpcReact.mcp.disable.useMutation({
		onSuccess: () => {
			utils.mcp.getSettings.invalidate()
			utils.mcp.listTokens.invalidate()
			dialogProps.onOpenChange(false)
		},
		onError: toastError,
	})

	// Picking an agent on first run opens its permissions; going back from
	// there remounts the intro as the picker, not the pitch
	const introDefaultView = useRef<'pitch' | 'picker'>('pitch')
	const chooseSetupAgent = (agent: McpAgentId | 'generic') => {
		setSelectedAgent(agent)
		introDefaultView.current = 'picker'
		setSetupAgent(agent)
	}

	// Continuing past the permissions starts a short "Enabling MCP server…"
	// beat: the dialog collapses into the status card, and only after both the
	// token is minted and the beat has played out does the connect view expand
	// around it. The mutation itself is near-instant; the pause is what makes
	// the moment land. If enabling fails, the permissions come back so
	// retrying is one click.
	const [showEnabling, setShowEnabling] = useState(false)
	const enablingTimer = useRef<number | undefined>(undefined)
	useEffect(() => () => window.clearTimeout(enablingTimer.current), [])

	const startEnable = (agent: McpAgentId | 'generic') => {
		setShowEnabling(true)
		window.clearTimeout(enablingTimer.current)
		enablingTimer.current = window.setTimeout(() => setShowEnabling(false), 2000)
		const knownAgent = MCP_AGENTS.find(({id}) => id === agent)
		enableMut.mutate({label: knownAgent?.name ?? 'Other agent', agentType: agent})
	}
	const resume = () => {
		setShowEnabling(true)
		window.clearTimeout(enablingTimer.current)
		enablingTimer.current = window.setTimeout(() => setShowEnabling(false), 2000)
		enableMut.mutate()
	}

	// ── Multi-token flow: Connect a new agent ───────────────────────
	const [addingAgent, setAddingAgent] = useState(false)
	// The freshly minted token for the connect ceremony, shown once — kept
	// apart from revealedCredential so the first-run enable flow stays untouched
	const [createdCredential, setCreatedCredential] = useState<McpCredential | null>(null)
	const [showCreating, setShowCreating] = useState(false)
	const creatingTimer = useRef<number | undefined>(undefined)
	useEffect(() => () => window.clearTimeout(creatingTimer.current), [])
	const createTokenMut = trpcReact.mcp.createToken.useMutation({
		onSuccess: () => utils.mcp.listTokens.invalidate(),
		onError: toastError,
	})
	const revokeTokenMut = trpcReact.mcp.revokeToken.useMutation({
		onSuccess: () => {
			utils.mcp.listTokens.invalidate()
			utils.mcp.getSettings.invalidate()
		},
		onError: toastError,
	})

	// The same short beat as enabling, retitled: the picker collapses into
	// the status card while the new token is minted
	const startCreateToken = async (agent: McpAgentId | 'generic') => {
		setSelectedAgent(agent)
		setShowCreating(true)
		window.clearTimeout(creatingTimer.current)
		creatingTimer.current = window.setTimeout(() => setShowCreating(false), 2000)
		const knownAgent = MCP_AGENTS.find(({id}) => id === agent)
		try {
			const credential = await createTokenMut.mutateAsync({
				label: knownAgent?.name ?? 'Other agent',
				agentType: agent,
			})
			setCreatedCredential(credential)
			setAddingAgent(false)
		} catch {
			// The mutation's onError owns the toast; staying in the picker makes retrying immediate.
		}
	}

	// Each agent is exactly one token, so removing the agent is revoking it
	const handleRevokeToken = async (token: McpToken) => {
		if (revokeTokenMut.isPending) return
		const knownAgent = MCP_AGENTS.find(({id}) => id === token.agentType)
		try {
			const result = await confirm({
				title: knownAgent
					? t('mcp-remove-agent-confirm-title', {name: knownAgent.name})
					: t('mcp-remove-agent-confirm-title-generic'),
				message: t('mcp-remove-agent-confirm-message'),
				actions: [
					{label: t('mcp-remove-agent-confirm-action'), value: 'confirm', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (result.actionValue !== 'confirm') return
		} catch {
			return
		}
		await revokeTokenMut.mutateAsync({id: token.id}).catch(() => {})
	}

	// The device is reachable however the user is reaching it right now — LAN
	// hostname, raw IP, Tailscale — so the endpoint URL agents should use keeps
	// the host this very dashboard is being served over, but always as plain
	// http: the device's https certificates aren't ones an agent's HTTP client
	// trusts, while the same host always serves the endpoint over http. Agents
	// installed as apps on this device are the exception — the connect view
	// swaps in the container-reachable gateway URL for them.
	const url = `http://${window.location.host}/mcp`

	// Every permission change reads the current permissions from the getSettings
	// cache, applies the change, and writes the whole object back — the
	// member-share read-modify-write discipline. Controls stay disabled while a
	// write is in flight so changes can't race each other.
	const setPermissionsMut = trpcReact.mcp.setPermissions.useMutation({
		onSuccess: () => utils.mcp.getSettings.invalidate(),
		onError: (error) => {
			toastError(error)
			utils.mcp.getSettings.invalidate()
		},
	})
	const updatePermissions = (patch: Partial<McpPermissions>) => {
		if (!settings) return
		setPermissionsMut.mutate({...settings.permissions, ...patch})
	}

	// Installed apps feed both the summary row icons and the app-access drill-in
	const appsQ = trpcReact.apps.list.useQuery()
	const installedApps: InstalledApp[] = (appsQ.data ?? []).map((app) => ({
		id: app.id,
		name: 'name' in app ? app.name : app.id,
		icon: 'icon' in app && app.icon ? app.icon : undefined,
	}))

	// Machines feed their drill-in the same way. Hardware that cannot run
	// machines at all hides the machine grants rather than offering an empty
	// list and a creation switch that could never work.
	const {machines} = useMachines()
	const {capabilities: machineCapabilities} = useMachineCapabilities()
	const machinesAvailable = machineCapabilities?.libvirtAvailable !== false

	const handleDisable = async () => {
		if (disableMut.isPending) return
		try {
			const result = await confirm({
				title: t('mcp-disable-confirm-title'),
				message: t('mcp-disable-confirm-message'),
				actions: [
					{label: t('mcp-disable-confirm-action'), value: 'confirm', variant: 'default'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (result.actionValue !== 'confirm') return
		} catch {
			return
		}
		disableMut.mutate()
	}

	// ── View selection ──────────────────────────────────────────────
	let content: React.ReactNode = null
	let showHeader = false
	// Keys the crossfade between the dialog's moments
	let contentKey = 'loading'
	// The status-card moments paint edge to edge, so the dialog's horizontal
	// padding is theirs to apply — the surrounding containers clip and scroll,
	// which a negative margin would only fight
	let bleed = false

	if ((!settings || !tokensQ.data) && (settingsQ.isError || tokensQ.isError)) {
		// No cached settings and the query failed — a backend hiccup. A dead end
		// needs an explanation and a way out, not an empty dialog. (Once settings
		// have loaded, background poll failures keep showing the last known state.)
		contentKey = 'error'
		content = (
			<div className='flex flex-col items-center gap-4 py-10 text-center'>
				<p className='text-13 leading-tight text-white/60'>{t('mcp-load-failed')}</p>
				<Button
					onClick={() => {
						settingsQ.refetch()
						tokensQ.refetch()
					}}
				>
					{t('try-again')}
				</Button>
			</div>
		)
	} else if (!settings || !tokensQ.data) {
		content = (
			<div className='grid place-items-center py-10'>
				<Loading />
			</div>
		)
	} else if (showEnabling || enableMut.isPending || (revealedCredential !== null && appsQ.isLoading)) {
		// The connect view can't pick between the container-gateway and
		// dashboard-host endpoint URLs until it knows whether the chosen agent is
		// installed as an app, so the enabling beat holds the (in practice already
		// resolved) apps query too. isLoading clears once the query settles or
		// exhausts retries — a failed apps list falls back to the dashboard-host
		// URL rather than blocking the show-once token screen.
		contentKey = 'enabling'
		bleed = true
		content = <McpStatusCard phase='enabling' />
	} else if (revealedCredential) {
		contentKey = 'connect'
		bleed = true
		const activeToken = tokens.find(({id}) => id === revealedCredential.id)
		content = (
			<ConnectView
				token={revealedCredential.token}
				url={url}
				installedAppIds={installedApps.map((app) => app.id)}
				initialAgent={selectedAgent}
				lastRequestAt={activeToken?.lastRequestAt ?? null}
				client={activeToken?.clients[0] ?? null}
				onDone={() => setRevealedCredential(null)}
			/>
		)
	} else if (showCreating || createTokenMut.isPending) {
		contentKey = 'creating'
		bleed = true
		content = <McpStatusCard phase='enabling' enablingLabel={t('mcp-creating-token')} />
	} else if (createdCredential) {
		contentKey = 'connect-new'
		bleed = true
		const activeToken = tokens.find(({id}) => id === createdCredential.id)
		content = (
			<ConnectView
				token={createdCredential.token}
				url={url}
				installedAppIds={installedApps.map((app) => app.id)}
				initialAgent={selectedAgent}
				lastRequestAt={activeToken?.lastRequestAt ?? null}
				client={activeToken?.clients[0] ?? null}
				onDone={() => setCreatedCredential(null)}
			/>
		)
	} else if (settings.enabled && addingAgent) {
		contentKey = 'add-agent'
		content = (
			<div className='flex flex-col gap-4'>
				<BackButton onClick={() => setAddingAgent(false)}>{t('mcp')}</BackButton>
				<IntroView connecting={createTokenMut.isPending} defaultView='picker' onSelect={startCreateToken} />
			</div>
		)
	} else if (!settings.enabled && (tokens.length > 0 || !setupAgent)) {
		contentKey = 'intro'
		content =
			tokens.length > 0 ? (
				<IntroView connecting={enableMut.isPending} onResume={resume} />
			) : (
				<IntroView connecting={false} defaultView={introDefaultView.current} onSelect={chooseSetupAgent} />
			)
	} else if (permissions && view === 'apps') {
		contentKey = 'apps'
		content = (
			<AppAccessDetail
				permissions={permissions}
				installedApps={installedApps}
				busy={setPermissionsMut.isPending}
				onUpdate={updatePermissions}
				onBack={() => setView('main')}
			/>
		)
	} else if (permissions && view === 'files') {
		contentKey = 'files'
		content = (
			<FileAccessDetail
				permissions={permissions}
				busy={setPermissionsMut.isPending}
				onUpdate={updatePermissions}
				onBack={() => setView('main')}
			/>
		)
	} else if (permissions && view === 'machines') {
		contentKey = 'machines'
		content = (
			<MachineAccessDetail
				permissions={permissions}
				machines={machines}
				busy={setPermissionsMut.isPending}
				onUpdate={updatePermissions}
				onBack={() => setView('main')}
			/>
		)
	} else if (permissions && !settings.enabled && setupAgent) {
		// First run, right after the agent is picked: the drill-ins above open
		// from here and return here, and MCP turns on only on continue
		contentKey = 'setup-permissions'
		content = (
			<PermissionsSetupView
				agent={setupAgent}
				permissions={permissions}
				installedApps={installedApps}
				machines={machines}
				machinesAvailable={machinesAvailable}
				busy={setPermissionsMut.isPending}
				onUpdate={updatePermissions}
				onShowApps={() => setView('apps')}
				onShowFiles={() => setView('files')}
				onShowMachines={() => setView('machines')}
				onBack={() => setSetupAgent(null)}
				onContinue={() => startEnable(setupAgent)}
			/>
		)
	} else if (permissions) {
		showHeader = true
		contentKey = 'main'
		content = (
			<EnabledView
				tokens={tokens}
				permissions={permissions}
				installedApps={installedApps}
				machines={machines}
				machinesAvailable={machinesAvailable}
				busy={setPermissionsMut.isPending}
				disabling={disableMut.isPending}
				revoking={revokeTokenMut.isPending}
				onUpdate={updatePermissions}
				onDisable={handleDisable}
				onConnectNewAgent={() => setAddingAgent(true)}
				onRevokeToken={handleRevokeToken}
				onShowApps={() => setView('apps')}
				onShowFiles={() => setView('files')}
				onShowMachines={() => setView('machines')}
			/>
		)
	}

	// Moments crossfade concurrently (popLayout floats the leaving one) while
	// the body height glides underneath — the cloud wizard treatment, so the
	// dialog never snaps between its very differently sized views. Concurrent
	// mounting is also what lets the status card's layoutId carry it from the
	// enabling beat into the connect view as one continuous object.
	const stepFade = {
		initial: {opacity: 0},
		animate: {opacity: 1},
		exit: {opacity: 0},
		transition: {duration: reducedMotion ? 0 : 0.18},
	}

	// The dialog primitives expect a semantic title in every view for the
	// accessible name, but only the enabled main view shows one visually — so a
	// constant hidden title carries the semantics, and the visible header is a
	// plain heading that can crossfade in and out with its view.
	if (isPhone) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight className='px-0'>
					<DrawerTitle className='sr-only'>{t('mcp')}</DrawerTitle>
					{showHeader && (
						<DrawerHeader className='px-5'>
							<h2 className='flex items-center gap-2 text-19 leading-tight font-bold'>
								{t('mcp')}
								<BetaPill />
							</h2>
						</DrawerHeader>
					)}
					<DrawerScroller>
						<AnimatePresence mode='popLayout' initial={false}>
							<motion.div key={contentKey} {...stepFade} className={cn(!bleed && 'px-5')}>
								{content}
							</motion.div>
						</AnimatePresence>
					</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<div className='py-6'>
					<DialogTitle className='sr-only'>{t('mcp')}</DialogTitle>
					<AnimatedHeight transition={{type: 'spring', stiffness: 300, damping: 34}} contentClassName='relative'>
						<AnimatePresence mode='popLayout' initial={false}>
							<motion.div key={contentKey} {...stepFade} className={cn('space-y-6', !bleed && 'px-5')}>
								{showHeader && (
									<DialogHeader>
										<h2 className='flex items-center gap-2 text-left text-17 leading-snug font-semibold -tracking-2'>
											{t('mcp')}
											<BetaPill />
										</h2>
									</DialogHeader>
								)}
								{content}
							</motion.div>
						</AnimatePresence>
					</AnimatedHeight>
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}

// ─── Enabled steady state ───────────────────────────────────────────
// Managing MCP is managing who can reach the device and what they can touch:
// the agents up top, each one its own token and removable in place, then the
// permission grants — Apps and Folders one drill-in deep, App Store and
// Manage umbrelOS as inline switches — with the off switch as a quiet action
// at the bottom.

function EnabledView({
	tokens,
	permissions,
	installedApps,
	machines,
	machinesAvailable,
	busy,
	disabling,
	revoking,
	onUpdate,
	onDisable,
	onConnectNewAgent,
	onRevokeToken,
	onShowApps,
	onShowFiles,
	onShowMachines,
}: {
	tokens: McpToken[]
	permissions: McpPermissions
	installedApps: InstalledApp[]
	machines: Machine[]
	machinesAvailable: boolean
	busy: boolean
	disabling: boolean
	revoking: boolean
	onUpdate: (patch: Partial<McpPermissions>) => void
	onDisable: () => void
	onConnectNewAgent: () => void
	onRevokeToken: (token: McpToken) => void
	onShowApps: () => void
	onShowFiles: () => void
	onShowMachines: () => void
}) {
	const {t} = useTranslation()

	return (
		<div className='flex flex-col gap-y-5'>
			<section className='flex flex-col gap-2'>
				<div className='flex items-center justify-between gap-3'>
					<SectionLabel>{t('mcp-agents')}</SectionLabel>
					<Button size='sm' onClick={onConnectNewAgent}>
						{t('mcp-connect-new-agent')}
					</Button>
				</div>
				<p className='-mt-1 text-12 leading-tight text-white/50'>{t('mcp-agents-description')}</p>
				<div className={listClass}>
					<ConnectionStatus tokens={tokens} revoking={revoking} onRevoke={onRevokeToken} />
				</div>
			</section>

			<PermissionsSection
				permissions={permissions}
				installedApps={installedApps}
				machines={machines}
				machinesAvailable={machinesAvailable}
				busy={busy}
				onUpdate={onUpdate}
				onShowApps={onShowApps}
				onShowFiles={onShowFiles}
				onShowMachines={onShowMachines}
			/>

			<div className='flex flex-wrap justify-end gap-2'>
				<Button disabled={disabling} className={cn(disabling && 'umbrel-pulse')} onClick={onDisable}>
					{t('mcp-disable')}
				</Button>
			</div>
		</div>
	)
}

// ─── First-run permissions ──────────────────────────────────────────
// The step between picking an agent and connecting it: the same grants as
// the steady state, settled while MCP is still off, so the first token is
// minted for an agent whose access the user has already decided.

function PermissionsSetupView({
	agent,
	onBack,
	onContinue,
	...permissionsProps
}: {
	agent: McpAgentId | 'generic'
	permissions: McpPermissions
	installedApps: InstalledApp[]
	machines: Machine[]
	machinesAvailable: boolean
	busy: boolean
	onUpdate: (patch: Partial<McpPermissions>) => void
	onShowApps: () => void
	onShowFiles: () => void
	onShowMachines: () => void
	onBack: () => void
	onContinue: () => void
}) {
	const {t} = useTranslation()
	const knownAgent = MCP_AGENTS.find(({id}) => id === agent)

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('back')}</BackButton>

			<div className='flex flex-col items-center gap-3 text-center'>
				<AgentLogoPlate agent={knownAgent ?? OTHER_AGENT} size={48} morph />
				<div className='space-y-1'>
					<h3 className='text-19 font-semibold -tracking-2'>
						{knownAgent
							? t('mcp-setup-permissions-title', {name: knownAgent.name})
							: t('mcp-setup-permissions-title-generic')}
					</h3>
					<p className='text-13 leading-tight text-white/70'>{t('mcp-setup-permissions-description')}</p>
				</div>
			</div>

			<PermissionsSection {...permissionsProps} />

			{/* Continuing waits out a permission write still in flight, so a
			    failed write shows up here rather than after the agent has its token */}
			<Button
				variant='primary'
				size='dialog'
				className='md:w-full'
				disabled={permissionsProps.busy}
				onClick={onContinue}
			>
				{t('continue')}
			</Button>
		</div>
	)
}

// The grants themselves — Apps, Folders and Machines one drill-in deep, App
// Store, machine creation and Manage umbrelOS as inline switches — shared by
// the first-run step and the enabled steady state
function PermissionsSection({
	permissions,
	installedApps,
	machines,
	machinesAvailable,
	busy,
	onUpdate,
	onShowApps,
	onShowFiles,
	onShowMachines,
}: {
	permissions: McpPermissions
	installedApps: InstalledApp[]
	machines: Machine[]
	machinesAvailable: boolean
	busy: boolean
	onUpdate: (patch: Partial<McpPermissions>) => void
	onShowApps: () => void
	onShowFiles: () => void
	onShowMachines: () => void
}) {
	const {t} = useTranslation()

	// Summary row content, mapped the same way the users list summarizes a
	// member's access
	const appIconById = new Map(installedApps.map((app) => [app.id, app.icon]))
	const allApps = permissions.apps === 'all'
	const grantedAppIds = permissions.apps === 'all' ? [] : permissions.apps
	const summaryAppIcons = (allApps ? installedApps.map((app) => app.id) : grantedAppIds).map((id) =>
		appIconById.get(id),
	)
	const appsSummaryLabel = allApps
		? t('mcp-all-apps')
		: grantedAppIds.length > 0
			? t('mcp-app-count', {count: grantedAppIds.length})
			: t('mcp-none')

	const allFolders = permissions.files === 'all'
	const grantedFolders = permissions.files === 'all' ? [] : permissions.files
	const folderGrants = grantedFolders.filter((path) => !isStorageCategoryPath(path))
	const storageSuffix = [
		grantedFolders.includes('/External') && t('mcp-summary-usb'),
		grantedFolders.includes('/Network') && t('mcp-summary-network'),
	]
		.filter(Boolean)
		.join(' ')
	// "None" only when nothing at all is granted — a storage-only grant reads
	// "+ USB", not "None + USB"
	const filesSummaryLabel = allFolders
		? t('mcp-all-folders')
		: folderGrants.length > 0
			? [t('mcp-folder-count', {count: folderGrants.length}), storageSuffix].filter(Boolean).join(' ')
			: storageSuffix || t('mcp-none')

	const machineById = new Map(machines.map((machine) => [machine.id, machine]))
	const allMachines = permissions.machines === 'all'
	const grantedMachineIds = permissions.machines === 'all' ? [] : permissions.machines
	const summaryMachineIcons = (allMachines ? machines.map((machine) => machine.id) : grantedMachineIds).map((id) => {
		const machine = machineById.get(id)
		return machine ? machineIconSrc(machine.osId) : undefined
	})
	const machinesSummaryLabel = allMachines
		? t('mcp-all-machines')
		: grantedMachineIds.length > 0
			? t('mcp-machine-count', {count: grantedMachineIds.length})
			: t('mcp-none')

	return (
		<section className='flex flex-col gap-2'>
			<SectionLabel>{t('mcp-permissions')}</SectionLabel>
			<p className='-mt-1 text-12 leading-tight text-white/50'>{t('mcp-always-available-description')}</p>
			<div className={listClass}>
				<button
					type='button'
					onClick={onShowApps}
					className='group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/4'
				>
					<span className='min-w-0 flex-1'>
						<span className='block truncate text-13 font-medium -tracking-2 text-white/90'>{t('mcp-apps')}</span>
						<span className='block text-12 leading-tight text-white/50'>{t('mcp-apps-summary')}</span>
					</span>
					<GrantSummary icons={summaryAppIcons} label={appsSummaryLabel} />
					<RowChevron />
				</button>
				<button
					type='button'
					onClick={onShowFiles}
					className='group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/4'
				>
					<span className='min-w-0 flex-1'>
						<span className='block truncate text-13 font-medium -tracking-2 text-white/90'>{t('mcp-folders')}</span>
						<span className='block text-12 leading-tight text-white/50'>{t('mcp-folders-summary')}</span>
					</span>
					<GrantSummary folder={allFolders || folderGrants.length > 0} label={filesSummaryLabel} />
					<RowChevron />
				</button>
				{machinesAvailable && (
					<button
						type='button'
						onClick={onShowMachines}
						className='group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/4'
					>
						<span className='min-w-0 flex-1'>
							<span className='block truncate text-13 font-medium -tracking-2 text-white/90'>{t('mcp-machines')}</span>
							<span className='block text-12 leading-tight text-white/50'>{t('mcp-machines-summary')}</span>
						</span>
						<GrantSummary icons={summaryMachineIcons} label={machinesSummaryLabel} />
						<RowChevron />
					</button>
				)}
				<PermissionToggleRow
					title={t('mcp-app-store')}
					description={t('mcp-app-store-description')}
					checked={permissions.appStore}
					disabled={busy}
					onCheckedChange={(checked) => onUpdate({appStore: checked})}
				/>
				{machinesAvailable && (
					<PermissionToggleRow
						title={t('mcp-create-machines')}
						description={t('mcp-create-machines-description')}
						checked={permissions.createMachines}
						disabled={busy}
						onCheckedChange={(checked) => onUpdate({createMachines: checked})}
					/>
				)}
				<PermissionToggleRow
					title={t('mcp-manage-system')}
					description={t('mcp-manage-system-description')}
					checked={permissions.manageSystem}
					disabled={busy}
					onCheckedChange={(checked) => onUpdate({manageSystem: checked})}
				/>
			</div>
		</section>
	)
}

// One row per owner-created credential. The label is trusted because the owner
// selected it; protocol clientInfo remains display-only telemetry within that
// credential and cannot impersonate another row.
function ConnectionStatus({
	tokens,
	revoking,
	onRevoke,
}: {
	tokens: McpToken[]
	revoking: boolean
	onRevoke: (token: McpToken) => void
}) {
	const {t} = useTranslation()
	// The rows' relative times and live dots depend on the clock, which the
	// compiler-memoized rows only see as a prop. A slow tick keeps them current,
	// and a poll can bring timestamps newer than the last tick.
	const [clock, setClock] = useState(() => Date.now())
	useInterval(() => setClock(Date.now()), 10_000)
	const now = Math.max(clock, ...tokens.map((token) => token.lastRequestAt ?? token.createdAt))

	return (
		<AnimatePresence initial={false}>
			{tokens.length > 0 ? (
				tokens.map((token) => (
					<AnimatedRow key={token.id} reorder>
						<TokenConnectionRow token={token} now={now} revoking={revoking} onRevoke={() => onRevoke(token)} />
					</AnimatedRow>
				))
			) : (
				<AnimatedRow key='empty' reorder>
					<div className='grid min-h-16 place-items-center px-4 py-5 text-center text-13 text-white/40'>
						{t('mcp-no-agents')}
					</div>
				</AnimatedRow>
			)}
		</AnimatePresence>
	)
}

// Agents quieter than this show a dim dot instead of the live green one — with
// several rows, "which of these is at work right now" is the glanceable question
const CLIENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000

function TokenConnectionRow({
	token,
	now,
	revoking,
	onRevoke,
}: {
	token: McpToken
	now: number
	revoking: boolean
	onRevoke: () => void
}) {
	const {t, i18n} = useTranslation()

	const reportedClient = token.clients[0]
	const agent = MCP_AGENTS.find(({id}) => id === token.agentType) ?? matchAgent(reportedClient?.name)
	const relative = (timestamp: number) =>
		formatDistanceStrict(timestamp, now, {
			addSuffix: true,
			locale: languageCodeToDateLocale[i18n.language as keyof typeof languageCodeToDateLocale],
		})
	const active = token.lastRequestAt !== null && now - token.lastRequestAt < CLIENT_ACTIVE_WINDOW_MS
	// Connecting the same agent from two machines gives two rows with the same
	// name and logo — when each was added is what tells them apart
	const added = t('mcp-agent-added', {time: relative(token.createdAt)})
	const activity =
		token.lastRequestAt === null ? t('mcp-agent-waiting') : t('mcp-last-request', {time: relative(token.lastRequestAt)})

	return (
		<div className='flex items-center gap-3 p-3'>
			<AgentLogoPlate agent={agent ?? OTHER_AGENT} size={32} className='shrink-0' />
			<span className='min-w-0 flex-1'>
				<span className='flex items-center gap-2'>
					<span className='truncate text-13 font-medium -tracking-2 text-white/90'>{token.label}</span>
					<span
						className={cn(
							'size-1.5 shrink-0 rounded-full',
							active ? 'bg-green-400 shadow-[0_0_6px] shadow-green-400/60' : 'bg-white/15',
						)}
					/>
				</span>
				{/* On narrow screens the line breaks between its two halves, never
				    inside one */}
				<span className='block text-12 leading-tight text-white/40'>
					<span className='whitespace-nowrap'>{added} ·</span> <span className='whitespace-nowrap'>{activity}</span>
				</span>
			</span>
			<RowRemoveButton label={t('mcp-remove-agent', {name: token.label})} disabled={revoking} onClick={onRevoke} />
		</div>
	)
}

// Full-width switch row used for the single-toggle permissions (App Store,
// Manage umbrelOS) inside the grouped permissions card
function PermissionToggleRow({
	title,
	description,
	checked,
	disabled,
	onCheckedChange,
}: {
	title: string
	description: string
	checked: boolean
	disabled?: boolean
	onCheckedChange: (checked: boolean) => void
}) {
	return (
		<label className='flex items-center justify-between gap-4 p-3'>
			<div className='min-w-0 flex-1'>
				<div className='text-13 font-medium -tracking-2 text-white/90'>{title}</div>
				<div className='text-12 leading-tight text-white/45'>{description}</div>
			</div>
			<Switch
				className={cn(disabled && 'umbrel-pulse')}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
			/>
		</label>
	)
}
