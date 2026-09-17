import type {CallToolResult, McpServer} from '@modelcontextprotocol/server'
import {beforeEach, expect, test, vi} from 'vitest'

import {normalizeAppMountTargetPath, normalizeAppStorageSourcePath} from '../../apps/app.js'
import registerAppTools from './apps.js'
import registerFileTools from './files.js'
import registerMachineTools from './machines.js'
import type {McpToolContext} from './shared.js'
import registerSystemInfoTools from './system-info.js'
import registerSystemManagementTools from './system-management.js'

type ToolHandler = (input: Record<string, unknown>) => Promise<CallToolResult>

const logger = {error: vi.fn(), log: vi.fn()}

function toolRegistry() {
	const registerTool = vi.fn()
	return {
		server: {registerTool} as unknown as McpServer,
		get(name: string) {
			const registration = registerTool.mock.calls.find(([toolName]) => toolName === name)
			if (!registration) throw new Error(`Tool '${name}' was not registered`)
			return {
				config: registration[1] as {
					annotations: Record<string, boolean>
					description: string
					inputSchema: {parse: (input: unknown) => Record<string, unknown>}
				},
				handler: registration[2] as ToolHandler,
			}
		},
	}
}

function parseToolResult(result: CallToolResult) {
	const content = result.content[0]
	if (!content || content.type !== 'text') throw new Error('Expected a text tool result')
	if (result.isError) throw new Error(content.text)
	return JSON.parse(content.text) as unknown
}

function baseContext() {
	return {
		dataDirectory: '/umbrel',
		rpc: {
			systemNg: {device: {getSpecs: vi.fn()}},
			system: {
				version: vi.fn(async () => ({version: '1.2.3', name: 'umbrelOS 1.2.3', previousVersion: undefined})),
				status: vi.fn(async () => 'running'),
				getReleaseChannel: vi.fn(async () => 'stable'),
				getHostname: vi.fn(async () => 'umbrel'),
				getIpAddresses: vi.fn(async () => ['192.168.1.10']),
				uptime: vi.fn(async () => 123),
				cpuUsage: vi.fn(),
				memoryUsage: vi.fn(),
				systemDiskUsage: vi.fn(),
				cpuTemperature: vi.fn(),
				checkUpdate: vi.fn(),
				updateStatus: vi.fn(async () => ({running: false})),
				update: vi.fn(async () => true),
				restart: vi.fn(async () => true),
				setHostname: vi.fn(async ({hostname}: {hostname: string}) => hostname),
				setReleaseChannel: vi.fn(async () => undefined),
				getNetworkInterfaces: vi.fn(async () => []),
				isExternalDns: vi.fn(async () => true),
				logs: vi.fn(async () => ''),
			},
			hardware: {raid: {getStatus: vi.fn(async () => ({exists: false}))}},
			wifi: {connected: vi.fn(async () => ({status: 'disconnected'}))},
			notifications: {get: vi.fn(async () => [])},
			appStore: {registry: vi.fn(async () => [])},
			apps: {
				list: vi.fn(async () => []),
				state: vi.fn(async () => ({state: 'not-installed', progress: 0})),
				details: vi.fn(),
				logs: vi.fn(async () => ''),
				start: vi.fn(async () => true),
				stop: vi.fn(async () => true),
				restart: vi.fn(async () => true),
				update: vi.fn(async () => true),
				install: vi.fn(async () => true),
				uninstall: vi.fn(async () => true),
				setSettings: vi.fn(async () => true),
				moveDataRoot: vi.fn(async () => true),
				resetDataRoot: vi.fn(async () => true),
			},
			files: {
				status: vi.fn(),
				listDirectoryPage: vi.fn(),
				createDirectory: vi.fn(),
				copy: vi.fn(),
				move: vi.fn(),
				rename: vi.fn(),
				trash: vi.fn(),
				search: vi.fn(async () => []),
			},
			machines: {
				list: vi.fn(async () => []),
				capabilities: vi.fn(async () => ({
					hostArchitecture: 'amd64',
					libvirtAvailable: true,
					kvmAvailable: true,
					nativeAcceleration: 'kvm',
					portRange: {start: 40_000, end: 40_100},
					guestHostAddress: '10.21.0.1',
				})),
				osImages: vi.fn(async () => []),
				create: vi.fn(),
				start: vi.fn(async () => true),
				stop: vi.fn(async () => true),
				restart: vi.fn(async () => true),
				forceStop: vi.fn(async () => true),
				retryInstall: vi.fn(async () => true),
				ejectInstallMedia: vi.fn(async () => true),
				uninstall: vi.fn(async () => true),
				updateSettings: vi.fn(),
				screenshot: vi.fn(),
				control: vi.fn(),
			},
		},
		machines: {control: vi.fn(), screenshot: vi.fn()},
		agent: {tokenId: 'a'.repeat(32), label: 'Claude Code', agentType: 'claude-code', clientName: 'claude-code'},
		mcp: {
			logger,
			getAppOperationFailure: vi.fn(),
			getAppOperation: vi.fn(() => null),
			assertAppAccess: vi.fn(),
			assertAppStoreAccess: vi.fn(),
			assertSystemAccess: vi.fn(),
			addAppGrant: vi.fn(),
			startAppOperation: vi.fn(),
			normalizeFilePath: vi.fn((path: string) => path),
			allowedFileGrants: vi.fn(async () => ['/Home']),
			assertFileAccess: vi.fn(async (path: string) => ({path, systemPath: `/system${path}`, grant: '/Home'})),
			assertFileWriteAccess: vi.fn(async (path: string) => ({path, systemPath: `/system${path}`, grant: '/Home'})),
			hasFullHomeAccess: vi.fn(async () => true),
			assertMachineAccess: vi.fn(),
			assertMachineCreateAccess: vi.fn(),
			addMachineGrant: vi.fn(),
		},
	} as unknown as McpToolContext
}

const noPermissions = {
	apps: [] as string[],
	appStore: false,
	files: [] as string[],
	manageSystem: false,
	machines: [] as string[],
	createMachines: false,
}

function appSettingsFixture() {
	return {
		id: 'wallet',
		name: 'Wallet',
		credentials: {defaultUsername: 'umbrel', defaultPassword: 'secret', showBeforeOpen: true, hideBeforeOpen: false},
		appProxyAuth: {supported: true, defaultEnabled: true, override: null, enabled: true},
		storage: {
			dataRoot: {location: null, canMoveExternally: true, status: 'available'},
			folderAccess: [
				{
					id: 'media',
					name: 'Media',
					note: 'Choose your media folder',
					sourcePath: '/Home/Movies',
					defaultSourcePath: null,
					mounts: [{serviceName: 'server', targetPath: '/media', readOnly: true}],
				},
			],
			customMounts: [{serviceName: 'server', targetPath: '/photos', sourcePath: '/Home/Photos', readOnly: true}],
			services: ['server'],
			serviceImages: {server: 'example/wallet:1.0'},
			occupiedTargets: [{serviceName: 'server', targetPath: '/data'}],
			missingSourcePaths: ['/Home/Photos'],
		},
		environment: {
			exposed: [
				{name: 'MODE', services: ['server'], default: 'auto', options: ['auto', 'manual'], note: null, value: null},
			],
			custom: [{serviceName: 'server', name: 'TZ', value: 'UTC'}],
			services: ['server'],
			serviceImages: {server: 'example/wallet:1.0'},
		},
		dependencies: ['bitcoin'],
		selectedDependencies: {bitcoin: 'bitcoin'},
	}
}

function appSettingsTool(context: McpToolContext) {
	const registry = toolRegistry()
	registerAppTools(registry.server, context, {...noPermissions, apps: ['wallet']})
	return registry.get('set_app_settings')
}

const machineFixture = {
	id: 'debian',
	name: 'Debian',
	osId: 'debian',
	osName: 'Debian',
	osVersion: '13',
	state: 'running',
	cores: 2,
	memoryGb: 4,
	diskSizeGb: 40,
	storageUsedGb: 3.5,
	ipAddress: '10.21.0.2',
	username: 'umbrel',
	arch: 'amd64',
	platformProfile: 'modern-x86',
	firmware: 'uefi',
	acceleration: 'kvm',
	portForwards: [{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22}],
	autostart: true,
	pinned: false,
	createdAt: 1_785_400_000_000,
	firstBootSetup: false,
	installPending: false,
	installationMediaAttached: false,
}

function imageContent(result: CallToolResult) {
	const [text, image] = result.content
	if (result.isError || !text || text.type !== 'text') throw new Error(text?.type === 'text' ? text.text : 'no text')
	if (!image || image.type !== 'image') throw new Error('Expected an image block')
	return {text: JSON.parse(text.text) as Record<string, unknown>, image}
}

beforeEach(() => vi.clearAllMocks())

test('system information uses routes and omits hardware identifiers', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.system.status).mockResolvedValue('updating')
	vi.mocked(context.rpc.system.getHostname).mockResolvedValue('homebox')
	vi.mocked(context.rpc.systemNg.device.getSpecs).mockResolvedValue({
		deviceId: 'U130121',
		device: 'Umbrel Home (2024)',
		productName: 'Umbrel Home',
		manufacturer: 'Umbrel',
		model: 'U130121',
		serial: 'SN0123456789',
		uuid: '4c4c4544-0043-3010-8043-b7c04f4d5632',
		cpu: 'Intel N150',
		memorySize: 16,
		memoryType: 'DDR5',
		storageSize: 2_000,
		storageType: 'NVMe SSD',
	} as never)

	const registry = toolRegistry()
	registerSystemInfoTools(registry.server, context)
	expect(parseToolResult(await registry.get('get_system_info').handler({}))).toStrictEqual({
		version: '1.2.3',
		versionName: 'umbrelOS 1.2.3',
		status: 'updating',
		releaseChannel: 'stable',
		hostname: 'homebox',
		ipAddresses: ['192.168.1.10'],
		uptimeSeconds: 123,
		deviceId: 'U130121',
		device: 'Umbrel Home (2024)',
		productName: 'Umbrel Home',
		manufacturer: 'Umbrel',
		model: 'U130121',
		cpu: 'Intel N150',
		memorySize: 16,
		memoryType: 'DDR5',
		storageSize: 2_000,
		storageType: 'NVMe SSD',
	})
})

test('system resources includes compact RAID health only when a pool exists', async () => {
	const context = baseContext()
	const cpu = {threads: 4, totalUsed: 20, system: 20, apps: [], machines: []}
	const memory = {size: 1_000, totalUsed: 500, system: 400, apps: [], machines: []}
	const storage = {size: 2_000, totalUsed: 800, available: 1_200}
	const temperature = {warning: 'normal' as const, temperature: 42}
	vi.mocked(context.rpc.system.cpuUsage).mockResolvedValue(cpu)
	vi.mocked(context.rpc.system.memoryUsage).mockResolvedValue(memory)
	vi.mocked(context.rpc.system.systemDiskUsage).mockResolvedValue(storage)
	vi.mocked(context.rpc.system.cpuTemperature).mockResolvedValue(temperature)

	const registry = toolRegistry()
	registerSystemInfoTools(registry.server, context)
	const handler = registry.get('get_system_resources').handler
	expect(parseToolResult(await handler({}))).toStrictEqual({cpu, memory, storage, temperature})

	vi.mocked(context.rpc.hardware.raid.getStatus).mockResolvedValueOnce({
		exists: true,
		status: 'DEGRADED',
		rebuild: {state: 'rebuilding', progress: 45},
		devices: [{id: 'disk-1', status: 'FAULTED', readErrors: 2, writeErrors: 1, checksumErrors: 3}],
	} as never)
	expect(parseToolResult(await handler({}))).toMatchObject({
		storageHealth: {status: 'DEGRADED', degraded: true, rebuild: {state: 'rebuilding', progress: 45}},
	})

	vi.mocked(context.rpc.system.cpuTemperature).mockRejectedValueOnce(new Error('No CPU temperature sensor'))
	const withoutTemperature = parseToolResult(await handler({})) as Record<string, unknown>
	expect(withoutTemperature).toMatchObject({cpu, memory, storage})
	expect(withoutTemperature).not.toHaveProperty('temperature')
})

test('app details aggregates app and system routes into the compact MCP response', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.apps.details).mockResolvedValue({
		id: 'bitcoin',
		name: 'Bitcoin Core',
		version: '28.0',
		tagline: 'Run Bitcoin',
		description: 'A node',
		state: 'ready',
		progress: 100,
		port: 8332,
		path: 'dashboard',
		requiresHttps: true,
		credentials: {username: 'umbrel', password: 'secret'},
		diskUsage: 123,
		dependents: ['electrs'],
	} as never)
	vi.mocked(context.rpc.system.getHostname).mockResolvedValue('homebox')
	vi.mocked(context.rpc.system.memoryUsage).mockResolvedValue({apps: [{id: 'bitcoin', used: 100}]} as never)
	vi.mocked(context.rpc.system.cpuUsage).mockResolvedValue({apps: [{id: 'bitcoin', used: 5}]} as never)

	const registry = toolRegistry()
	registerAppTools(registry.server, context, {
		apps: ['bitcoin'],
		appStore: false,
		files: [],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	expect(parseToolResult(await registry.get('get_app_details').handler({appId: 'bitcoin'}))).toMatchObject({
		id: 'bitcoin',
		url: 'https://homebox.local:8332/dashboard',
		credentials: {username: 'umbrel', password: 'secret'},
		dependents: ['electrs'],
		usage: {cpu: 5, memory: 100, disk: 123},
	})
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('bitcoin')
	expect(context.rpc.apps.details).toHaveBeenCalledWith({appId: 'bitcoin'})
})

test('app details exposes the full settings metadata and installed dependency choices', async () => {
	const context = baseContext()
	const app = appSettingsFixture()
	vi.mocked(context.rpc.apps.list).mockResolvedValue([
		app,
		{id: 'bitcoin', name: 'Bitcoin Core', state: 'ready'},
		{id: 'bitcoin-knots', name: 'Bitcoin Knots', state: 'ready', implements: ['bitcoin']},
		{id: 'bitcoin-installing', name: 'Installing provider', state: 'installing', implements: ['bitcoin']},
		{id: 'bitcoin-uninstalling', name: 'Uninstalling provider', state: 'uninstalling', implements: ['bitcoin']},
		{id: 'unrelated', name: 'Unrelated app'},
	] as never)
	vi.mocked(context.rpc.apps.details).mockResolvedValue({
		id: 'wallet',
		credentials: {username: 'umbrel', password: 'secret'},
	} as never)
	vi.mocked(context.rpc.system.memoryUsage).mockResolvedValue({apps: []} as never)
	vi.mocked(context.rpc.system.cpuUsage).mockResolvedValue({apps: []} as never)
	const registry = toolRegistry()
	registerAppTools(registry.server, context, {...noPermissions, apps: ['wallet']})

	expect(parseToolResult(await registry.get('get_app_details').handler({appId: 'wallet'}))).toMatchObject({
		credentials: {username: 'umbrel', password: 'secret'},
		settings: {
			appProxyAuth: app.appProxyAuth,
			storage: app.storage,
			environment: app.environment,
			dependencies: ['bitcoin'],
			selectedDependencies: {bitcoin: 'bitcoin'},
			dependencyChoices: [
				{
					dependencyId: 'bitcoin',
					apps: [
						{id: 'bitcoin', name: 'Bitcoin Core'},
						{id: 'bitcoin-knots', name: 'Bitcoin Knots'},
					],
				},
			],
			hideCredentialsBeforeOpen: false,
		},
	})
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('wallet')

	// The display preference is independent of whether the app currently has credentials.
	vi.mocked(context.rpc.apps.list).mockResolvedValueOnce([
		{...app, credentials: {showBeforeOpen: false, hideBeforeOpen: false}},
	] as never)
	expect(parseToolResult(await registry.get('get_app_details').handler({appId: 'wallet'}))).toMatchObject({
		settings: {hideCredentialsBeforeOpen: false},
	})
})

test('set_app_settings saves all groups together after checking newly introduced access', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.apps.list).mockResolvedValue([appSettingsFixture()] as never)
	vi.mocked(context.rpc.apps.state).mockResolvedValue({state: 'ready', progress: 100})
	const tool = appSettingsTool(context)
	const input = tool.config.inputSchema.parse({
		appId: 'wallet',
		appProxyAuthEnabled: false,
		hideCredentialsBeforeOpen: true,
		folderAccess: [{id: 'media', sourcePath: '/External/Drive/Movies'}],
		customMounts: [{serviceName: 'server', targetPath: '/photos', sourcePath: '/Home/New Photos', readOnly: false}],
		environment: [{name: 'MODE', value: 'manual'}],
		customEnvironment: [{serviceName: 'server', name: 'TZ', value: 'Australia/Brisbane'}],
		dependencies: {bitcoin: 'bitcoin-knots'},
	})

	expect(parseToolResult(await tool.handler(input))).toMatchObject({
		saved: true,
		appId: 'wallet',
		state: 'ready',
		progress: 100,
	})
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('wallet')
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('bitcoin-knots')
	expect(context.mcp.assertFileAccess).toHaveBeenCalledWith('/External/Drive/Movies')
	expect(context.mcp.assertFileAccess).toHaveBeenCalledWith('/Home/New Photos')
	expect(context.rpc.apps.setSettings).toHaveBeenCalledTimes(1)
	expect(context.rpc.apps.setSettings).toHaveBeenCalledWith(input)
})

test.each([
	{appProxyAuthEnabled: false},
	{appProxyAuthEnabled: null},
	{hideCredentialsBeforeOpen: false},
	{environment: []},
	{customEnvironment: []},
	{folderAccess: []},
	{customMounts: []},
	{dependencies: {}},
])('set_app_settings preserves omitted groups when saving %j', async (settings) => {
	const context = baseContext()
	vi.mocked(context.rpc.apps.list).mockResolvedValue([appSettingsFixture()] as never)
	const tool = appSettingsTool(context)
	const input = tool.config.inputSchema.parse({appId: 'wallet', ...settings})

	expect((await tool.handler(input)).isError).not.toBe(true)
	expect(context.rpc.apps.setSettings).toHaveBeenCalledTimes(1)
	expect(context.rpc.apps.setSettings).toHaveBeenCalledWith(input)
	expect(context.mcp.assertFileAccess).not.toHaveBeenCalled()
	expect(context.mcp.assertAppAccess).toHaveBeenCalledTimes(1)
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('wallet')
})

test('set_app_settings rejects an empty update and propagates save failures', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.apps.list).mockResolvedValue([appSettingsFixture()] as never)
	const tool = appSettingsTool(context)
	expect((await tool.handler({appId: 'wallet'})).isError).toBe(true)
	expect(context.rpc.apps.setSettings).not.toHaveBeenCalled()

	vi.mocked(context.rpc.apps.setSettings).mockRejectedValueOnce(new Error('[apps-settings-save-failed]'))
	expect((await tool.handler({appId: 'wallet', environment: []})).isError).toBe(true)
	expect(context.rpc.apps.state).not.toHaveBeenCalled()
})

test.each(['canonical', 'equivalent'])(
	'set_app_settings keeps unchanged folder entries without file grants using %s paths',
	async (syntax) => {
		const context = baseContext()
		const app = appSettingsFixture()
		vi.mocked(context.rpc.apps.list).mockResolvedValue([app] as never)
		vi.mocked(context.mcp.assertFileAccess).mockRejectedValue(new Error('[permission-denied]'))
		const tool = appSettingsTool(context)
		const input = tool.config.inputSchema.parse({
			appId: 'wallet',
			folderAccess:
				syntax === 'canonical'
					? [{id: 'media', sourcePath: '/Home/Movies'}]
					: [{id: ' media ', sourcePath: '/Home/Movies/'}],
			customMounts:
				syntax === 'canonical'
					? app.storage.customMounts
					: [{serviceName: ' server ', targetPath: '/photos/', sourcePath: '/Home/Photos/', readOnly: true}],
			environment: [{name: 'MODE', value: 'manual'}],
		})

		expect((await tool.handler(input)).isError).not.toBe(true)
		expect(context.rpc.apps.setSettings).toHaveBeenCalledTimes(1)
		expect(context.rpc.apps.setSettings).toHaveBeenCalledWith({
			appId: 'wallet',
			folderAccess: [{id: 'media', sourcePath: '/Home/Movies'}],
			customMounts: app.storage.customMounts,
			environment: [{name: 'MODE', value: 'manual'}],
		})
		expect(context.mcp.assertFileAccess).not.toHaveBeenCalled()
	},
)

test.each([
	[{id: 'media', sourcePath: '/Home/New Movies'}, '/Home/New Movies'],
	[{id: 'another-slot', sourcePath: '/Home/Movies'}, '/Home/Movies'],
])('set_app_settings checks a changed folder slot %j', async (folder, checkedPath) => {
	const context = baseContext()
	vi.mocked(context.rpc.apps.list).mockResolvedValue([appSettingsFixture()] as never)
	vi.mocked(context.mcp.assertFileAccess).mockRejectedValue(new Error('[permission-denied]'))
	const tool = appSettingsTool(context)

	expect((await tool.handler({appId: 'wallet', folderAccess: [folder]})).isError).toBe(true)
	expect(context.mcp.assertFileAccess).toHaveBeenCalledWith(checkedPath)
	expect(context.rpc.apps.setSettings).not.toHaveBeenCalled()
})

test.each([
	{sourcePath: '/Home/New Photos'},
	{targetPath: '/new-photos'},
	{serviceName: 'another-service'},
	{readOnly: false},
])('set_app_settings checks a custom mount changed by %j', async (change) => {
	const context = baseContext()
	const app = appSettingsFixture()
	const mount = {...app.storage.customMounts[0], ...change}
	vi.mocked(context.rpc.apps.list).mockResolvedValue([app] as never)
	vi.mocked(context.mcp.assertFileAccess).mockRejectedValue(new Error('[permission-denied]'))
	const tool = appSettingsTool(context)

	expect((await tool.handler({appId: 'wallet', customMounts: [mount]})).isError).toBe(true)
	expect(context.mcp.assertFileAccess).toHaveBeenCalledWith(mount.sourcePath)
	expect(context.rpc.apps.setSettings).not.toHaveBeenCalled()
})

test.each(
	(['folderAccess', 'customMounts'] as const).flatMap((group) =>
		['/Home/Shared ', '/Home/Shared /', '/Home/Shared /.', '/Home/Shared /x/..'].map(
			(sourcePath) => [group, sourcePath] as const,
		),
	),
)('set_app_settings preserves the exact authorized folder for %s with source %j', async (group, sourcePath) => {
	const context = baseContext()
	vi.mocked(context.rpc.apps.list).mockResolvedValue([appSettingsFixture()] as never)
	const tool = appSettingsTool(context)
	const entry =
		group === 'folderAccess'
			? {id: 'media', sourcePath}
			: {serviceName: 'server', targetPath: '/shared', sourcePath, readOnly: true}

	// Access to the plain name does not authorize its sibling whose name ends in a space.
	vi.mocked(context.mcp.assertFileAccess).mockImplementation(async (path) => {
		if (path !== '/Home/Shared') throw new Error('[permission-denied]')
		return {path, systemPath: `/system${path}`, grant: '/Home/Shared'}
	})
	expect((await tool.handler({appId: 'wallet', [group]: [entry]})).isError).toBe(true)
	expect(context.mcp.assertFileAccess).toHaveBeenCalledWith('/Home/Shared ')
	expect(context.rpc.apps.setSettings).not.toHaveBeenCalled()

	vi.mocked(context.mcp.assertFileAccess).mockImplementation(async (path) => {
		if (path !== '/Home/Shared ') throw new Error('[permission-denied]')
		return {path, systemPath: `/system${path}`, grant: '/Home/Shared '}
	})
	expect((await tool.handler({appId: 'wallet', [group]: [entry]})).isError).not.toBe(true)
	expect(context.rpc.apps.setSettings).toHaveBeenCalledTimes(1)
	expect(context.rpc.apps.setSettings).toHaveBeenCalledWith({
		appId: 'wallet',
		[group]: [{...entry, sourcePath: '/Home/Shared '}],
	})
	const savedSourcePath = vi.mocked(context.rpc.apps.setSettings).mock.calls[0][0][group]![0].sourcePath
	// Core settings normalizes again. That second pass must not change the authorized folder.
	expect(normalizeAppStorageSourcePath(savedSourcePath)).toBe(savedSourcePath)
})

test('set_app_settings preserves spaces in an unchanged custom mount target', async () => {
	const context = baseContext()
	const app = appSettingsFixture()
	const mount = {...app.storage.customMounts[0], targetPath: '/photos '}
	app.storage.customMounts = [mount]
	vi.mocked(context.rpc.apps.list).mockResolvedValue([app] as never)
	vi.mocked(context.mcp.assertFileAccess).mockRejectedValue(new Error('[permission-denied]'))
	const tool = appSettingsTool(context)

	expect((await tool.handler({appId: 'wallet', customMounts: [{...mount, targetPath: '/photos /'}]})).isError).not.toBe(
		true,
	)
	expect(context.mcp.assertFileAccess).not.toHaveBeenCalled()
	expect(context.rpc.apps.setSettings).toHaveBeenCalledWith({appId: 'wallet', customMounts: [mount]})
	const savedTargetPath = vi.mocked(context.rpc.apps.setSettings).mock.calls[0][0].customMounts![0].targetPath
	expect(savedTargetPath).toBe('/photos ')
	expect(normalizeAppMountTargetPath(savedTargetPath)).toBe(savedTargetPath)
})

test('set_app_settings rejects a custom mount target with leading whitespace', async () => {
	const context = baseContext()
	const app = appSettingsFixture()
	vi.mocked(context.rpc.apps.list).mockResolvedValue([app] as never)
	const tool = appSettingsTool(context)
	const result = await tool.handler({
		appId: 'wallet',
		customMounts: [{...app.storage.customMounts[0], targetPath: ' /photos'}],
	})

	expect(result.isError).toBe(true)
	expect(result.content).toEqual([
		{type: 'text', text: expect.stringContaining('[apps-settings-invalid-container-path]')},
	])
	expect(context.rpc.apps.setSettings).not.toHaveBeenCalled()
})

test('set_app_settings checks new dependency providers but preserves unchanged selections', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.apps.list).mockResolvedValue([appSettingsFixture()] as never)
	vi.mocked(context.mcp.assertAppAccess).mockImplementation(async (appId) => {
		if (appId !== 'wallet') throw new Error('[permission-denied]')
	})
	const tool = appSettingsTool(context)

	expect((await tool.handler({appId: 'wallet', dependencies: {bitcoin: 'bitcoin'}})).isError).not.toBe(true)
	expect(context.mcp.assertAppAccess).toHaveBeenCalledTimes(1)
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('wallet')
	vi.mocked(context.rpc.apps.setSettings).mockClear()
	expect((await tool.handler({appId: 'wallet', dependencies: {bitcoin: 'bitcoin-knots'}})).isError).toBe(true)
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('bitcoin-knots')
	expect(context.rpc.apps.setSettings).not.toHaveBeenCalled()

	// An empty record restores canonical providers, which can introduce a new app too.
	vi.mocked(context.rpc.apps.list).mockResolvedValue([
		{...appSettingsFixture(), selectedDependencies: {bitcoin: 'bitcoin-knots'}},
	] as never)
	expect((await tool.handler({appId: 'wallet', dependencies: {}})).isError).toBe(true)
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('bitcoin')
	expect(context.rpc.apps.setSettings).not.toHaveBeenCalled()
})

test.each([
	['get_app_details', {}],
	['set_app_settings', {appProxyAuthEnabled: false}],
	['move_app_data', {destinationParentPath: null}],
	['reset_app_data', {}],
])('%s denies revoked app access before reading or changing app settings', async (name, settings) => {
	const context = baseContext()
	vi.mocked(context.mcp.assertAppAccess).mockRejectedValue(new Error('[permission-denied]'))
	const registry = toolRegistry()
	registerAppTools(registry.server, context, {...noPermissions, apps: ['wallet']})

	expect((await registry.get(name).handler({appId: 'wallet', ...settings})).isError).toBe(true)
	expect(context.rpc.apps.list).not.toHaveBeenCalled()
	expect(context.rpc.apps.details).not.toHaveBeenCalled()
	expect(context.rpc.apps.setSettings).not.toHaveBeenCalled()
	expect(context.mcp.startAppOperation).not.toHaveBeenCalled()
	expect(context.rpc.apps.moveDataRoot).not.toHaveBeenCalled()
	expect(context.rpc.apps.resetDataRoot).not.toHaveBeenCalled()
})

test.each([
	['move_app_data', {destinationParentPath: '/External/Drive/App Data'}, 'move-data'],
	['move_app_data', {destinationParentPath: null}, 'move-data'],
	['reset_app_data', {}, 'reset-data'],
])('%s dispatches %j through tracked app operations', async (name, settings, operationName) => {
	const context = baseContext()
	const registry = toolRegistry()
	registerAppTools(registry.server, context, {...noPermissions, apps: ['wallet']})
	const input = {appId: 'wallet', ...settings}

	expect(parseToolResult(await registry.get(name).handler(input))).toStrictEqual({
		accepted: true,
		appId: 'wallet',
		operation: operationName,
	})
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('wallet')
	expect(context.mcp.startAppOperation).toHaveBeenCalledWith('wallet', operationName, expect.any(Function))
	// The expensive filesystem work runs in the queued operation, not before acceptance.
	expect(context.rpc.apps.moveDataRoot).not.toHaveBeenCalled()
	expect(context.rpc.apps.resetDataRoot).not.toHaveBeenCalled()
	const task = vi.mocked(context.mcp.startAppOperation).mock.calls[0][2]
	await task()
	if (name === 'move_app_data') {
		expect(context.rpc.apps.moveDataRoot).toHaveBeenCalledTimes(1)
		expect(context.rpc.apps.moveDataRoot).toHaveBeenCalledWith(input)
	} else {
		expect(context.rpc.apps.resetDataRoot).toHaveBeenCalledTimes(1)
		expect(context.rpc.apps.resetDataRoot).toHaveBeenCalledWith(input)
	}
	if ('destinationParentPath' in settings && settings.destinationParentPath !== null) {
		expect(context.mcp.assertFileWriteAccess).toHaveBeenCalledWith(settings.destinationParentPath)
	} else {
		expect(context.mcp.assertFileWriteAccess).not.toHaveBeenCalled()
	}
})

test('move_app_data denies an ungranted external destination before queuing the move', async () => {
	const context = baseContext()
	vi.mocked(context.mcp.assertFileWriteAccess).mockRejectedValue(new Error('[permission-denied]'))
	const registry = toolRegistry()
	registerAppTools(registry.server, context, {...noPermissions, apps: ['wallet']})

	expect(
		(await registry.get('move_app_data').handler({appId: 'wallet', destinationParentPath: '/External/Drive/App Data'}))
			.isError,
	).toBe(true)
	expect(context.mcp.startAppOperation).not.toHaveBeenCalled()
	expect(context.rpc.apps.moveDataRoot).not.toHaveBeenCalled()
})

test('move_app_data forwards the canonical destination checked by file permissions', async () => {
	const context = baseContext()
	vi.mocked(context.mcp.assertFileWriteAccess).mockResolvedValue({
		path: '/External/Drive/App Data',
		systemPath: '/system/External/Drive/App Data',
		grant: '/External',
	})
	const registry = toolRegistry()
	registerAppTools(registry.server, context, {...noPermissions, apps: ['wallet']})
	await registry.get('move_app_data').handler({appId: 'wallet', destinationParentPath: '/External/Drive/./App Data'})
	const task = vi.mocked(context.mcp.startAppOperation).mock.calls[0][2]
	await task()
	expect(context.rpc.apps.moveDataRoot).toHaveBeenCalledWith({
		appId: 'wallet',
		destinationParentPath: '/External/Drive/App Data',
	})
})

test('app status includes an active background operation even before app state changes', async () => {
	const context = baseContext()
	vi.mocked(context.mcp.getAppOperation).mockReturnValue('move-data')
	vi.mocked(context.mcp.getAppOperationFailure).mockReturnValue(null)
	vi.mocked(context.rpc.apps.state).mockResolvedValue({state: 'ready', progress: 100})
	const registry = toolRegistry()
	registerAppTools(registry.server, context, noPermissions)

	expect(parseToolResult(await registry.get('get_app_status').handler({appId: 'wallet'}))).toStrictEqual({
		appId: 'wallet',
		state: 'ready',
		progress: 100,
		activeOperation: 'move-data',
		lastOperationFailure: null,
	})
})

test('App Store tools return compact summaries and forward install alternatives through routes', async () => {
	const context = baseContext()
	const storeApp = {
		id: 'wallet',
		name: 'Wallet',
		tagline: 'A Bitcoin wallet',
		version: '1.2.3',
		category: 'Finance',
		compatible: true,
		description: 'A deliberately long description',
		dependencies: ['bitcoin'],
		installSize: 1_000_000,
		releaseNotes: 'Adds coin control',
	}
	vi.mocked(context.rpc.appStore.registry).mockResolvedValue([{apps: [storeApp]}] as never)
	vi.mocked(context.rpc.apps.list).mockResolvedValue([
		{
			id: 'bitcoin-knots',
			name: 'Bitcoin Knots',
			version: '28.1',
			state: 'ready',
			progress: 100,
			implements: ['bitcoin'],
		},
	] as never)
	let operation: Promise<void> | undefined
	vi.mocked(context.mcp.startAppOperation).mockImplementation((_appId, _name, task) => {
		operation = task()
	})

	const registry = toolRegistry()
	registerAppTools(registry.server, context, {
		apps: [],
		appStore: true,
		files: [],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	expect(parseToolResult(await registry.get('list_apps').handler({}))).toMatchObject([
		{id: 'bitcoin-knots', progress: 100, implements: ['bitcoin']},
	])
	expect(parseToolResult(await registry.get('search_app_store').handler({query: 'wallet', limit: 20}))).toMatchObject([
		{id: 'wallet', installed: false},
	])
	expect(parseToolResult(await registry.get('get_app_store_details').handler({appId: 'wallet'}))).toMatchObject({
		...storeApp,
		implements: [],
		installed: false,
	})

	await registry.get('install_app').handler({appId: 'wallet', alternatives: {bitcoin: 'bitcoin-knots'}})
	if (!operation) throw new Error('Install operation was not started')
	await operation
	expect(context.rpc.apps.install).toHaveBeenCalledWith({
		appId: 'wallet',
		alternatives: {bitcoin: 'bitcoin-knots'},
	})
	expect(context.mcp.addAppGrant).toHaveBeenCalledWith('wallet')
	expect(() => registry.get('get_app_details')).not.toThrow()
	expect(() => registry.get('get_app_logs')).toThrow()
})

test('app tools report incompatible updates without claiming they can be installed', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.appStore.registry).mockResolvedValue([
		{apps: [{id: 'wallet', version: '2.0.0', compatible: false}]},
	] as never)
	vi.mocked(context.rpc.apps.list).mockResolvedValue([
		{id: 'wallet', name: 'Wallet', version: '1.0.0', state: 'ready', progress: 100},
	] as never)

	const registry = toolRegistry()
	registerAppTools(registry.server, context, {
		apps: ['wallet'],
		appStore: false,
		files: [],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	expect(parseToolResult(await registry.get('list_apps').handler({}))).toMatchObject([
		{id: 'wallet', updateAvailable: true, updateCompatible: false},
	])
})

test('app logs clamp requests, bound the route output and retain only the newest safe lines', async () => {
	const context = baseContext()
	const tenLines = Array.from({length: 10}, (_line, index) => `line ${index + 1}`).join('\n')
	vi.mocked(context.rpc.apps.logs).mockResolvedValue(`${tenLines}\n`)
	const registry = toolRegistry()
	registerAppTools(registry.server, context, {
		apps: ['bitcoin'],
		appStore: false,
		files: [],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	const tool = registry.get('get_app_logs')

	const input = tool.config.inputSchema.parse({appId: 'bitcoin', lines: 5_000})
	expect(input).toStrictEqual({appId: 'bitcoin', lines: 500})
	expect(parseToolResult(await tool.handler({...input, lines: 3}))).toStrictEqual({
		appId: 'bitcoin',
		logs: 'line 8\nline 9\nline 10',
	})
	expect(context.rpc.apps.logs).toHaveBeenCalledWith({appId: 'bitcoin', maxOutputBytes: 64_000})

	const fatLine = 'y'.repeat(2_000)
	vi.mocked(context.rpc.apps.logs).mockResolvedValue(
		[...Array.from({length: 40}, () => fatLine), 'x'.repeat(3_000)].join('\n'),
	)
	const result = parseToolResult(await tool.handler({appId: 'bitcoin', lines: 500})) as {
		logs: string
		truncated: boolean
		droppedLines: number
	}
	expect(result.truncated).toBe(true)
	expect(result.droppedLines).toBe(10)
	expect(Buffer.byteLength(result.logs)).toBeLessThanOrEqual(64_000)
})

test('system logs require system access and pass bounds through the route', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.system.logs).mockResolvedValue('line one\nline two')
	const registry = toolRegistry()
	registerSystemManagementTools(registry.server, context)
	const tool = registry.get('get_system_logs')

	const input = tool.config.inputSchema.parse({type: 'umbrelos', lines: 15_000})
	expect(input).toStrictEqual({type: 'umbrelos', lines: 1500})
	expect(parseToolResult(await tool.handler(input))).toStrictEqual({logs: 'line one\nline two'})
	expect(context.mcp.assertSystemAccess).toHaveBeenCalledOnce()
	expect(context.rpc.system.logs).toHaveBeenCalledWith({type: 'umbrelos', lines: 1500, maxOutputBytes: 64_000})
})

test('directory listing retains grant checks while delegating listing to Files', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.files.listDirectoryPage).mockResolvedValue({
		name: 'Home',
		path: '/Home',
		type: 'directory',
		size: 0,
		modified: 0,
		operations: [],
		files: [{name: 'one.txt', path: '/Home/one.txt', type: 'text/plain', size: 1, modified: 0, operations: []}],
		totalFiles: 1,
		hasMore: false,
	} as never)
	const registry = toolRegistry()
	registerFileTools(registry.server, context, {
		apps: [],
		appStore: false,
		files: ['/Home'],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	expect(parseToolResult(await registry.get('list_directory').handler({path: '/Home', limit: 2}))).toMatchObject({
		path: '/Home',
		files: [{name: 'one.txt'}],
		totalFiles: 1,
		hasMore: false,
	})
	expect(context.mcp.assertFileAccess).toHaveBeenCalledWith('/Home')
	expect(context.rpc.files.listDirectoryPage).toHaveBeenCalledWith({path: '/Home', lastFile: undefined, limit: 2})
})

test('file transfers never expose replacement and explain safe collision choices', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.files.copy).mockResolvedValue('/Home/Destination/report (2).txt')
	const registry = toolRegistry()
	registerFileTools(registry.server, context, {
		apps: [],
		appStore: false,
		files: ['/Home'],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	const copy = registry.get('copy')
	const move = registry.get('move')

	for (const tool of [copy, move]) {
		expect(() =>
			tool.config.inputSchema.parse({
				path: '/Home/report.txt',
				toDirectory: '/Home/Destination',
				collision: 'replace',
			}),
		).toThrow()
	}
	expect(
		parseToolResult(
			await copy.handler({path: '/Home/report.txt', toDirectory: '/Home/Destination', collision: 'keep-both'}),
		),
	).toMatchObject({path: '/Home/Destination/report (2).txt', note: expect.stringContaining('original was unchanged')})
	expect(context.mcp.assertFileWriteAccess).toHaveBeenCalledWith('/Home/Destination/report.txt')

	vi.mocked(context.rpc.files.copy).mockRejectedValueOnce(new Error('[destination-already-exists]'))
	const conflict = await copy.handler({path: '/External/report.txt', toDirectory: '/Network/share', collision: 'error'})
	expect(conflict).toMatchObject({isError: true})
	expect(conflict.content[0]).toMatchObject({type: 'text', text: expect.stringContaining('USB/network items')})
})

test('app IDs and tool annotations preserve the MCP contract', () => {
	const context = baseContext()
	const systemInfo = toolRegistry()
	registerSystemInfoTools(systemInfo.server, context)
	const apps = toolRegistry()
	registerAppTools(apps.server, context, {
		apps: ['installed'],
		appStore: true,
		files: [],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	const systemManagement = toolRegistry()
	registerSystemManagementTools(systemManagement.server, context)
	const files = toolRegistry()
	registerFileTools(files.server, context, {
		apps: [],
		appStore: false,
		files: ['/Home'],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})

	const longAppId = 'a'.repeat(65)
	expect(apps.get('get_app_status').config.inputSchema.parse({appId: longAppId})).toMatchObject({appId: longAppId})
	expect(() => apps.get('get_app_status').config.inputSchema.parse({appId: 'invalid/app'})).toThrow()
	for (const [registry, name, openWorld] of [
		[systemInfo, 'check_os_update', true],
		[systemInfo, 'get_system_info', false],
		[apps, 'list_apps', true],
		[apps, 'update_app', true],
		[apps, 'restart_app', false],
		[apps, 'set_app_settings', false],
		[apps, 'move_app_data', false],
		[apps, 'reset_app_data', false],
		[systemManagement, 'install_os_update', true],
		[systemManagement, 'restart_device', false],
	] as const) {
		expect(registry.get(name).config.annotations.openWorldHint).toBe(openWorld)
	}
	expect(systemManagement.get('restart_device').config.annotations.destructiveHint).toBe(true)
	expect(apps.get('reset_app_data').config.annotations.destructiveHint).toBe(true)
	expect(files.get('trash').config.annotations.destructiveHint).toBe(true)
	expect(files.get('copy').config.annotations.destructiveHint).toBe(false)
})

test('machine tools follow the grant model: listing always, control per machine, creation on its own', () => {
	const context = baseContext()
	const none = toolRegistry()
	registerMachineTools(none.server, context, noPermissions)
	expect(none.get('list_machines').config.annotations.readOnlyHint).toBe(true)
	expect(() => none.get('get_machine_details')).toThrow()
	expect(() => none.get('control_machine')).toThrow()
	expect(() => none.get('create_machine')).toThrow()

	const granted = toolRegistry()
	registerMachineTools(granted.server, context, {...noPermissions, machines: ['debian']})
	expect(granted.get('get_machine_screenshot').config.annotations.readOnlyHint).toBe(true)
	expect(granted.get('control_machine').config.annotations.readOnlyHint).toBe(false)
	expect(granted.get('delete_machine').config.annotations.destructiveHint).toBe(true)
	expect(granted.get('force_stop_machine').config.annotations.destructiveHint).toBe(true)
	expect(granted.get('stop_machine').config.annotations.destructiveHint).toBe(false)
	expect(() => granted.get('create_machine')).toThrow()
	expect(() => granted.get('list_os_images')).toThrow()

	const creator = toolRegistry()
	registerMachineTools(creator.server, context, {...noPermissions, createMachines: true})
	expect(creator.get('list_os_images').config.annotations.openWorldHint).toBe(true)
	expect(creator.get('create_machine').config.annotations.destructiveHint).toBe(false)
	expect(() => creator.get('control_machine')).toThrow()

	const control = granted.get('control_machine').config.inputSchema
	expect(control.parse({machineId: 'debian', action: 'left_click', coordinate: [10, 20]})).toMatchObject({
		coordinate: [10, 20],
	})
	expect(control.parse({machineId: 'debian', action: 'long_press', coordinate: [1, 1], duration: 2})).toMatchObject({
		duration: 2,
	})
	expect(() => control.parse({machineId: 'debian', action: 'teleport'})).toThrow()
	expect(() => control.parse({machineId: 'debian', action: 'left_click', coordinate: [-1, 0]})).toThrow()
	expect(() => control.parse({machineId: 'Not Valid', action: 'key', text: 'Return'})).toThrow()
	const create = creator.get('create_machine').config.inputSchema
	const base = {name: 'Box', diskSizeGb: 20, cores: 2, memoryGb: 2}
	expect(() => create.parse({...base, osId: 'debian', imagePath: '/Home/x.iso'})).toThrow()
	expect(() => create.parse(base)).toThrow()
	expect(create.parse({...base, osId: 'debian'})).toMatchObject({osId: 'debian'})
})

test('machine lifecycle and detail tools check the grant, use the routes, and answer with fresh state', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.machines.list).mockResolvedValue([machineFixture] as never)
	vi.mocked(context.rpc.system.cpuUsage).mockResolvedValue({
		threads: 4,
		totalUsed: 30,
		system: 10,
		apps: [],
		machines: [{id: 'debian', name: 'Debian', osId: 'debian', used: 20}],
	} as never)
	vi.mocked(context.rpc.system.memoryUsage).mockResolvedValue({
		size: 16,
		totalUsed: 8,
		system: 4,
		apps: [],
		machines: [{id: 'debian', name: 'Debian', osId: 'debian', used: 4}],
	} as never)
	const registry = toolRegistry()
	registerMachineTools(registry.server, context, {...noPermissions, machines: ['debian']})

	expect(parseToolResult(await registry.get('list_machines').handler({}))).toStrictEqual([
		{
			id: 'debian',
			name: 'Debian',
			os: {id: 'debian', name: 'Debian', version: '13'},
			arch: 'amd64',
			state: 'running',
			firstBootSetup: false,
			cores: 2,
			memoryGb: 4,
			diskSizeGb: 40,
			storageUsedGb: 3.5,
			acceleration: 'kvm',
		},
	])

	expect(parseToolResult(await registry.get('start_machine').handler({machineId: 'debian'}))).toMatchObject({
		operation: 'start',
		id: 'debian',
		state: 'running',
	})
	expect(context.mcp.assertMachineAccess).toHaveBeenCalledWith('debian')
	expect(context.rpc.machines.start).toHaveBeenCalledWith({id: 'debian'})

	expect(parseToolResult(await registry.get('get_machine_details').handler({machineId: 'debian'}))).toMatchObject({
		id: 'debian',
		ipAddress: '10.21.0.2',
		username: 'umbrel',
		portForwards: [{hostPort: 40_022, guestPort: 22}],
		usage: {cpu: 20, memory: 4},
	})

	vi.mocked(context.mcp.assertMachineAccess).mockRejectedValueOnce(new Error('[permission-denied] nope'))
	const denied = await registry.get('delete_machine').handler({machineId: 'debian'})
	expect(denied.isError).toBe(true)
	expect(context.rpc.machines.uninstall).not.toHaveBeenCalled()
})

test('screenshots and control actions return an image block beside the JSON summary', async () => {
	const context = baseContext()
	const screenshot = {width: 1568, height: 882, mimeType: 'image/jpeg', data: 'aGVsbG8='}
	vi.mocked(context.machines.screenshot).mockResolvedValue(screenshot as never)
	vi.mocked(context.machines.control).mockResolvedValue(screenshot as never)
	const registry = toolRegistry()
	registerMachineTools(registry.server, context, {...noPermissions, machines: 'all'})

	const captured = imageContent(await registry.get('get_machine_screenshot').handler({machineId: 'debian'}))
	expect(captured.text).toStrictEqual({
		machineId: 'debian',
		screenshot: {width: 1568, height: 882, mimeType: 'image/jpeg'},
	})
	expect(captured.image).toMatchObject({type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg'})
	// The agent behind the credential is named at the console
	expect(context.machines.screenshot).toHaveBeenCalledWith('debian', {agent: context.agent})

	const acted = imageContent(
		await registry.get('control_machine').handler({machineId: 'debian', action: 'type', text: 'ls\n'}),
	)
	expect(acted.text).toMatchObject({machineId: 'debian', action: 'type'})
	expect(context.machines.control).toHaveBeenCalledWith(
		'debian',
		{action: 'type', text: 'ls\n'},
		{agent: context.agent},
	)
	expect(context.mcp.assertMachineAccess).toHaveBeenCalledTimes(2)
})

test('create_machine routes custom sources through the file grants and grants the new machine', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.machines.create).mockResolvedValue({
		...machineFixture,
		id: 'custom',
		state: 'installing',
		installationState: 'preparing',
		installProgress: 0,
	} as never)
	const registry = toolRegistry()
	registerMachineTools(registry.server, context, {...noPermissions, createMachines: true})

	const input = {
		name: 'Custom',
		imagePath: '/Home/images/custom.iso',
		diskDirectory: '/External/disks',
		diskSizeGb: 20,
		cores: 2,
		memoryGb: 2,
	}
	expect(parseToolResult(await registry.get('create_machine').handler(input))).toMatchObject({
		id: 'custom',
		state: 'installing',
		installationState: 'preparing',
		note: expect.stringContaining('list_machines'),
	})
	expect(context.mcp.assertMachineCreateAccess).toHaveBeenCalled()
	expect(context.mcp.assertFileAccess).toHaveBeenCalledWith('/Home/images/custom.iso')
	expect(context.mcp.assertFileWriteAccess).toHaveBeenCalledWith('/External/disks')
	expect(context.rpc.machines.create).toHaveBeenCalledWith(input)
	expect(context.mcp.addMachineGrant).toHaveBeenCalledWith('custom')

	vi.mocked(context.mcp.assertFileAccess).mockRejectedValueOnce(new Error('[permission-denied] not granted'))
	const denied = await registry.get('create_machine').handler(input)
	expect(denied.isError).toBe(true)
	expect(context.rpc.machines.create).toHaveBeenCalledTimes(1)

	expect(parseToolResult(await registry.get('list_os_images').handler({}))).toMatchObject({
		host: {architecture: 'amd64', virtualizationAvailable: true, acceleration: 'kvm'},
		images: [],
	})
})
