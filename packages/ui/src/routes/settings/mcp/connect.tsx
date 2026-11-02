import {useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {TbCheck, TbCopy} from 'react-icons/tb'
import {useCopyToClipboard} from 'react-use'

import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import {useUserApp} from '@/providers/apps'
import {
	cursorDeeplink,
	genericSnippet,
	INSTALLED_AGENT_MCP_URL,
	matchAgent,
	MCP_AGENTS,
	OTHER_AGENT,
	type McpAgentId,
	type McpAgentVisual,
} from '@/routes/settings/mcp/agents'
import {AgentLogoPlate} from '@/routes/settings/mcp/constellation'
import {McpStatusCard} from '@/routes/settings/mcp/status-card'
import {appToUrl, sleep} from '@/utils/misc'

// Everything needed to finish the job in one sitting: a paste-ready setup per
// agent (each snippet carries the show-once token), a plain-language message
// for agents that can edit their own config, and a live status that flips the
// moment the agent says hello.

export type McpClient = {name: string; title?: string} | null

export function ConnectView({
	token,
	url,
	installedAppIds,
	initialAgent,
	lastRequestAt,
	client,
	onDone,
}: {
	token: string
	url: string
	installedAppIds: string[]
	initialAgent: McpAgentId | 'generic'
	lastRequestAt: number | null
	client: McpClient
	onDone: () => void
}) {
	const {t} = useTranslation()
	const [selected, setSelected] = useState<McpAgentId | 'generic'>(initialAgent)
	// Escape hatch for agents that also exist outside this device: with the
	// OpenClaw app installed, the user may still be connecting an OpenClaw on
	// their laptop, which needs the dashboard host, not the container gateway
	const [connectingElsewhere, setConnectingElsewhere] = useState(false)
	const {app: murmurApp} = useUserApp('murmur')

	const selectAgent = (id: McpAgentId | 'generic') => {
		setSelected(id)
		// Each chip opens on its own best guess, not the previous chip's override
		setConnectingElsewhere(false)
	}

	// Snippets display a masked token so the ceremony's masking isn't undone by
	// the setup examples — copying still yields the real thing.
	const maskedToken = `${token.slice(0, 14)}…`
	const agent = MCP_AGENTS.find(({id}) => id === selected)
	// An agent installed as an app on this Umbrel connects from inside a
	// container, where the dashboard's own host may not resolve — its setup
	// gets the fixed Docker gateway URL instead
	const agentInstalled = agent?.appId !== undefined && installedAppIds.includes(agent.appId)
	const onThisUmbrel = agentInstalled && !connectingElsewhere
	const endpointUrl = onThisUmbrel ? INSTALLED_AGENT_MCP_URL : url
	const snippet = (tokenValue: string) =>
		agent ? agent.snippet(endpointUrl, tokenValue) : genericSnippet(endpointUrl, tokenValue)

	const hintByAgent: Record<McpAgentId | 'generic', string> = {
		'claude-code': t('mcp-connect-hint-claude-code'),
		codex: t('mcp-connect-hint-codex'),
		cursor: t('mcp-connect-hint-cursor'),
		openclaw: t('mcp-connect-hint-openclaw'),
		hermes: t('mcp-connect-hint-hermes'),
		murmur: t('mcp-connect-hint-murmur'),
		generic: t('mcp-connect-hint-generic'),
	}
	// The standard hints point at "your terminal" / "your dotfiles" — the wrong
	// machine for an agent living in an app container on this device
	const installedHintByAgent: Partial<Record<McpAgentId | 'generic', string>> = {
		openclaw: t('mcp-connect-hint-openclaw-installed'),
		hermes: t('mcp-connect-hint-hermes-installed'),
		murmur: t('mcp-connect-hint-murmur-installed'),
	}
	const hint = (onThisUmbrel ? installedHintByAgent[selected] : undefined) ?? hintByAgent[selected]

	// lastRequestAt resets server-side on every enable/regenerate, so any value
	// at all means this very token has already been used successfully
	const connected = lastRequestAt !== null
	// Murmur's agents run in its own Hermes, which says hello as Hermes, so a
	// key made for Murmur greets as Murmur when Hermes is the one using it
	const reportedAgent = matchAgent(client?.name)
	const connectedAgent =
		initialAgent === 'murmur' && reportedAgent?.id === 'hermes'
			? MCP_AGENTS.find(({id}) => id === 'murmur')
			: reportedAgent
	const connectedName = connectedAgent?.name ?? client?.title ?? client?.name

	return (
		<div className='flex flex-col gap-y-5'>
			{/* The status card paints edge to edge, so the dialog's horizontal
			    padding lives on the groups around it, not on this view's root */}
			<div className='flex flex-col gap-y-5 px-5'>
				<h3 className='text-15 font-semibold -tracking-2'>{t('mcp-connect-title')}</h3>

				<div className='flex flex-wrap gap-1.5'>
					{MCP_AGENTS.map((entry) => (
						<AgentChip
							key={entry.id}
							visual={entry}
							label={entry.name}
							selected={selected === entry.id}
							onSelect={() => selectAgent(entry.id)}
						/>
					))}
					<AgentChip
						visual={OTHER_AGENT}
						label={t('mcp-connect-agent-other')}
						selected={selected === 'generic'}
						onSelect={() => selectAgent('generic')}
					/>
				</div>

				<div className='flex flex-col gap-2.5'>
					<h3 className='text-13 font-medium -tracking-2 text-white/90'>{hint}</h3>
					{selected === 'cursor' && (
						<Button asChild size='sm' className='self-start'>
							<a href={cursorDeeplink(endpointUrl, token)}>{t('mcp-connect-add-to-cursor')}</a>
						</Button>
					)}
					{/* Murmur on this Umbrel takes the key from the fragment of its own
					    settings page (never sent to a server), clears it from the
					    address bar and connects when the user taps Connect. Opened
					    directly: launching the app the usual way would put the key in
					    umbrelOS's own URL. */}
					{selected === 'murmur' && onThisUmbrel && murmurApp && (
						<Button
							size='sm'
							className='self-start'
							onClick={() =>
								window.open(
									`${appToUrl(murmurApp)}/settings/umbrel#token=${encodeURIComponent(token)}`,
									'_blank',
									'noopener',
								)
							}
						>
							{t('mcp-connect-open-murmur')}
						</Button>
					)}
					<CopyCard display={snippet(maskedToken)} value={snippet(token)} />
					{agentInstalled && agent && (
						<button
							type='button'
							onClick={() => setConnectingElsewhere(!connectingElsewhere)}
							className='self-start text-12 leading-tight text-white/60 underline decoration-white/20 underline-offset-2 transition-colors hover:text-white/70'
						>
							{connectingElsewhere
								? t('mcp-connect-local-link', {name: agent.name})
								: t('mcp-connect-remote-link', {name: agent.name})}
						</button>
					)}
				</div>

				{/* Murmur is connected from its own settings, not by its agents */}
				{selected !== 'murmur' && (
					<div className='flex flex-col gap-2.5'>
						<h3 className='text-13 font-medium -tracking-2 text-white/90'>{t('mcp-connect-message-label')}</h3>
						<CopyCard
							display={t('mcp-connect-message', {url: endpointUrl, token: maskedToken})}
							value={t('mcp-connect-message', {url: endpointUrl, token})}
							mono={false}
						/>
					</div>
				)}

				{/* The tip stays out of the way when the agent lives on this very
				    Umbrel — the container gateway URL above works regardless of
				    where the user roams */}
				{!onThisUmbrel && isLocalOrigin(window.location.hostname) && <TailscaleTip endpointUrl={endpointUrl} />}
			</div>

			<McpStatusCard phase={connected ? 'connected' : 'waiting'} name={connectedName} agent={connectedAgent} />

			<div className='px-5'>
				<Button className='w-full' onClick={onDone}>
					{t('done')}
				</Button>
			</div>
		</div>
	)
}

function AgentChip({
	visual,
	label,
	selected,
	onSelect,
}: {
	visual: McpAgentVisual
	label: string
	selected: boolean
	onSelect: () => void
}) {
	return (
		<button
			type='button'
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-12 font-medium -tracking-2 transition-colors',
				selected
					? 'border-white/25 bg-white/12 text-white'
					: 'border-white/6 bg-white/3 text-white/60 hover:bg-white/8 hover:text-white/90',
			)}
		>
			<AgentLogoPlate agent={visual} size={16} className='shrink-0 !shadow-none' />
			{label}
		</button>
	)
}

// A labeled block where the whole card is one big copy button (the invite
// message card treatment from users.tsx)
function CopyCard({display, value, mono = true}: {display: string; value: string; mono?: boolean}) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [copied, setCopied] = useState(false)

	return (
		<button
			type='button'
			onClick={async () => {
				copyToClipboard(value)
				setCopied(true)
				await sleep(2000)
				setCopied(false)
			}}
			className={cn(
				'group relative w-full rounded-12 bg-white/6 p-3 pr-10 text-left text-12 leading-relaxed whitespace-pre-wrap text-white/70 transition-colors hover:bg-white/8',
				mono ? 'font-mono break-all' : 'break-words',
			)}
		>
			{display}
			<span className='absolute top-3 right-3'>
				{copied ? (
					<TbCheck className='size-4 text-brand-lighter' />
				) : (
					<TbCopy className='size-4 text-white/30 transition-colors group-hover:text-white/70' />
				)}
			</span>
		</button>
	)
}

// ─── Tailscale tip ──────────────────────────────────────────────────
// The setup snippets carry whatever host this dashboard is reached over. A
// LAN-only origin (umbrel.local, a private IP) means the agent loses its
// Umbrel the moment either machine leaves home — so nudge toward Tailscale,
// which gives both a stable, end-to-end encrypted address. Tailscale's own
// 100.64/10 range and MagicDNS *.ts.net names read as remote-ready and get
// no tip, as does any public domain.
function isLocalOrigin(hostname: string) {
	if (!hostname.includes('.') || hostname.endsWith('.local')) return true
	const octets = hostname.split('.').map(Number)
	if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
		if (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168)) return true
		if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
	}
	return false
}

// Tailscale's app icon in a bordered card whose gradient fades into the
// dialog. "Tailscale" links to its App Store page in a new tab so the
// show-once token ceremony isn't lost. The <tailscale-ip> placeholder is
// HTML-escaped in the translation (a literal angle bracket would be parsed
// as a tag by Trans) and shouldUnescape renders the brackets back.
function TailscaleTip({endpointUrl}: {endpointUrl: string}) {
	const {t} = useTranslation()
	return (
		<div className='flex items-center gap-3 rounded-12 border border-white/6 bg-linear-to-r from-white/6 to-transparent p-3'>
			<img
				src='https://getumbrel.github.io/umbrel-apps-gallery/tailscale/icon.svg'
				alt=''
				aria-hidden='true'
				className='size-8 shrink-0 rounded-8'
			/>
			<p className='text-left text-12 leading-snug text-white/50'>
				<Trans
					t={t}
					i18nKey='mcp-connect-tailscale-tip'
					values={{url: endpointUrl}}
					shouldUnescape
					components={[
						<a
							key='tailscale'
							href='/app-store/tailscale'
							target='_blank'
							rel='noopener noreferrer'
							className='font-medium text-white/80 underline decoration-white/25 underline-offset-2 transition-colors hover:text-white'
						/>,
						<span key='tailscale-url' className='font-mono text-[11px] text-white/70' />,
						<span key='current-url' className='font-mono text-[11px] text-white/70' />,
					]}
				/>
			</p>
		</div>
	)
}
