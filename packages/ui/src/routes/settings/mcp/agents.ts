// The agents that get first-class setup treatment in the MCP panel: hero
// satellites in the intro, a logo chip and a paste-ready snippet in the
// connect view, and identity matching for the "Claude Code · 2 minutes ago"
// status line. Brand names are intentionally untranslated.

export type McpAgentId = 'claude-code' | 'codex' | 'cursor' | 'openclaw' | 'hermes' | 'murmur'

// The visual identity shared by registry entries and the "any other agent"
// pseudo-entry (the waving robot)
export type McpAgentVisual = {
	id: McpAgentId | 'generic'
	logo: string
	// Full app-icon squares render edge to edge; bare brand marks sit inset on
	// a white plate (the cloud-logo treatment)
	tile: boolean
}

export type McpAgent = McpAgentVisual & {
	id: McpAgentId
	name: string
	// App Store id for agents that can run on this device as an Umbrel app —
	// when installed, the connect view defaults to the in-container endpoint URL
	appId?: string
	// False keeps an agent out of the picker's tiles, everywhere else it appears
	picker?: false
	// Substrings matched case-insensitively against the MCP clientInfo name
	clientMatch: string[]
	snippet: (url: string, token: string) => string
}

// Where app containers reach this device: every app joins Umbrel's shared
// Docker network, whose host-side gateway is the fixed GATEWAY_IP from the
// app-script environment. The host the dashboard is browsed over often fails
// inside a container (umbrel.local is mDNS, which doesn't cross the container
// boundary), so agents installed as apps get this URL instead.
export const INSTALLED_AGENT_MCP_URL = 'http://10.21.0.1/mcp'

// Everything that speaks MCP but isn't in the registry, fronted by a friendly
// robot in the constellation, the picker, and the setup chips
export const OTHER_AGENT: McpAgentVisual = {
	id: 'generic',
	logo: '/assets/mcp/other-agent.webp',
	tile: true,
}

// Registry order is display order: constellation slots, picker tiles, and
// setup chips all follow it. Murmur leads as Umbrel's own home for Hermes.
export const MCP_AGENTS: McpAgent[] = [
	{
		id: 'murmur',
		name: 'Murmur',
		logo: '/assets/mcp/murmur.webp',
		tile: true,
		appId: 'murmur',
		// Murmur's agents run in its own Hermes, which identifies itself as
		// Hermes. Its key is still shown as Murmur everywhere, by its agent type,
		// and 'hermes' isn't matched here, which would take the Hermes Agent
		// entry's matches.
		clientMatch: ['murmur'],
		// Murmur finds the key in whatever is pasted into it
		snippet: (url, token) => genericSnippet(url, token),
	},
	{
		id: 'hermes',
		name: 'Hermes Agent',
		logo: '/assets/mcp/hermes.webp',
		tile: true,
		appId: 'hermes-agent',
		clientMatch: ['hermes'],
		snippet: (url, token) =>
			`mcp_servers:\n  umbrel:\n    url: "${url}"\n    headers:\n      Authorization: "Bearer ${token}"`,
	},
	{
		id: 'openclaw',
		name: 'OpenClaw',
		logo: '/assets/mcp/openclaw.webp',
		tile: true,
		appId: 'openclaw',
		clientMatch: ['openclaw', 'clawdbot', 'moltbot'],
		snippet: (url, token) =>
			`openclaw mcp set umbrel '{"url":"${url}","transport":"streamable-http","headers":{"Authorization":"Bearer ${token}"}}'`,
	},
	{
		id: 'claude-code',
		name: 'Claude Code',
		logo: '/assets/mcp/claude-code.webp',
		tile: false,
		clientMatch: ['claude'],
		snippet: (url, token) => `claude mcp add --transport http umbrel ${url} --header "Authorization: Bearer ${token}"`,
	},
	{
		id: 'codex',
		name: 'Codex',
		logo: '/assets/mcp/codex.webp',
		tile: false,
		// Codex's HTTP MCP config has no direct bearer-token field (only
		// bearer_token_env_var), so the static-header form is the copy-pasteable one
		clientMatch: ['codex', 'openai'],
		snippet: (url, token) =>
			`[mcp_servers.umbrel]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`,
	},
	{
		id: 'cursor',
		name: 'Cursor',
		logo: '/assets/mcp/cursor.webp',
		tile: false,
		// Still one of the agents orbiting in the intro, and still a setup chip,
		// but the picker's tiles are kept to the agents most people connect
		picker: false,
		clientMatch: ['cursor'],
		snippet: (url, token) =>
			JSON.stringify({mcpServers: {umbrel: {url, headers: {Authorization: `Bearer ${token}`}}}}, null, 2),
	},
]

// What a clientInfo match resolves to: enough identity to render a name and
// logo anywhere a connected agent shows up
export type McpMatchedAgent = {
	id: string
	name: string
	logo: string
	tile: boolean
	// Substrings matched case-insensitively against the MCP clientInfo name
	clientMatch: string[]
}

// Agents that get the name-and-logo treatment when they identify themselves
// over MCP — the connected-agents list and the connect ceremony's hello
// moment — but aren't featured in the constellation, the picker, or the
// setup chips
export const RECOGNIZED_AGENTS: McpMatchedAgent[] = [
	{
		id: 'opencode',
		name: 'OpenCode',
		logo: '/assets/mcp/opencode.webp',
		tile: false,
		// The literal "opencode" hardcoded in its MCP client ("opencode-debug"
		// from its debug command) — anomalyco/opencode packages/opencode/src/mcp/index.ts
		clientMatch: ['opencode'],
	},
]

export function genericSnippet(url: string, token: string) {
	return `${url}\nAuthorization: Bearer ${token}`
}

// One-click install link; Cursor decodes the base64 JSON into ~/.cursor/mcp.json
export function cursorDeeplink(url: string, token: string) {
	const config = btoa(JSON.stringify({url, headers: {Authorization: `Bearer ${token}`}}))
	return `cursor://anysphere.cursor-deeplink/mcp/install?name=umbrel&config=${encodeURIComponent(config)}`
}

// Maps the agent's self-declared MCP clientInfo to a featured or recognized
// entry so the status line can show a proper name and logo
export function matchAgent(clientName: string | undefined): McpMatchedAgent | undefined {
	if (!clientName) return undefined
	const normalized = clientName.toLowerCase()
	return [...MCP_AGENTS, ...RECOGNIZED_AGENTS].find((agent) =>
		agent.clientMatch.some((needle) => normalized.includes(needle)),
	)
}
