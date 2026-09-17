import type {McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod4'

import {normalizeAppMountTargetPath, normalizeAppStorageSourcePath} from '../../apps/app.js'
import {fillSelectedDependencies} from '../../utilities/dependencies.js'
import type {McpPermissions} from '../mcp.js'
import {MAX_LOG_BYTES, newestLogs, runTool, type McpToolContext} from './shared.js'

// Mirrors the canonical validation in App and AppStore.
const appIdSchema = z.string().regex(/^[a-zA-Z0-9-_]+$/)

const appInput = z.object({
	appId: appIdSchema.describe('The installed app ID.'),
})
const appLogsInput = appInput.extend({
	lines: z
		.number()
		.int()
		.min(1)
		.overwrite((lines) => Math.min(lines, 500))
		.max(500)
		.default(200)
		.describe('Number of newest log lines to return (default 200, maximum 500).'),
})
const installReadyNote =
	'When the app reaches ready, call get_app_details and share its URL and any default login credentials with the user.'

async function registryApps(context: McpToolContext) {
	const registry = await context.rpc.appStore.registry()
	return registry.flatMap(({apps}) => apps)
}

async function installedAppIds(context: McpToolContext) {
	return new Set((await context.rpc.apps.list()).map(({id}) => id))
}

type InstalledApp = Awaited<ReturnType<McpToolContext['rpc']['apps']['list']>>[number]

function appSettings(app: InstalledApp, installed: InstalledApp[]) {
	if ('error' in app) throw new Error(app.error)
	return {
		appProxyAuth: app.appProxyAuth,
		hideCredentialsBeforeOpen: app.credentials.hideBeforeOpen,
		storage: app.storage,
		environment: app.environment,
		dependencies: app.dependencies ?? [],
		selectedDependencies: app.selectedDependencies,
		dependencyChoices: (app.dependencies ?? []).map((dependencyId) => ({
			dependencyId,
			apps: installed.flatMap((candidate) =>
				!('error' in candidate) &&
				candidate.state !== 'installing' &&
				candidate.state !== 'uninstalling' &&
				(candidate.id === dependencyId || candidate.implements?.includes(dependencyId))
					? [{id: candidate.id, name: candidate.name}]
					: [],
			),
		})),
	}
}

async function runAppOperation(
	context: McpToolContext,
	appId: string,
	operation: 'start' | 'stop' | 'restart' | 'update',
) {
	if (operation === 'start') return context.rpc.apps.start({appId})
	if (operation === 'stop') return context.rpc.apps.stop({appId})
	if (operation === 'restart') return context.rpc.apps.restart({appId})
	return context.rpc.apps.update({appId})
}

export default function registerAppTools(server: McpServer, context: McpToolContext, permissions: McpPermissions) {
	server.registerTool(
		'list_apps',
		{
			title: 'List installed apps',
			description:
				'List installed umbrelOS apps with their current state, progress, version, update availability, and implemented dependency IDs.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				// This also queries the public registry to calculate updateAvailable.
				openWorldHint: true,
			},
		},
		(input) =>
			runTool(context, 'list_apps', input, async () => {
				const [apps, registry] = await Promise.all([context.rpc.apps.list(), registryApps(context).catch(() => [])])
				const latestApps = new Map(registry.map((app) => [app.id, app]))
				return apps.map((app) => {
					if ('error' in app) return {id: app.id, error: app.error}
					const latestApp = latestApps.get(app.id)
					const updateAvailable = latestApp !== undefined && latestApp.version !== app.version
					return {
						id: app.id,
						name: app.name,
						version: app.version,
						state: app.state,
						progress: app.progress,
						updateAvailable,
						...(updateAvailable ? {updateCompatible: latestApp.compatible} : {}),
						...(app.implements ? {implements: app.implements} : {}),
					}
				})
			}),
	)

	server.registerTool(
		'get_app_status',
		{
			title: 'Get app status',
			description:
				'Get an app state, progress, active background operation, and its most recent operation failure. After moving or resetting app data, poll until activeOperation is null and check lastOperationFailure.',
			inputSchema: appInput,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'get_app_status', input, async () => {
				const {state, progress} = await context.rpc.apps.state({appId: input.appId})
				return {
					appId: input.appId,
					state,
					progress,
					activeOperation: context.mcp.getAppOperation(input.appId),
					lastOperationFailure: context.mcp.getAppOperationFailure(input.appId),
				}
			}),
	)

	const hasAppGrants = permissions.apps === 'all' || permissions.apps.length > 0

	// Also registered for App Store access alone so install_app's ready note names
	// a visible tool; the per-app grant check still runs on every call.
	if (hasAppGrants || permissions.appStore) {
		server.registerTool(
			'get_app_details',
			{
				title: 'Get app details',
				description:
					'Get details, launch URL, credentials, resource usage, dependents, and umbrelOS app settings for a granted app. Settings include authentication, folder slots, custom mounts, app-data location, environment variables with defaults and options, dependency choices, and the credentials display preference. Change ordinary settings with set_app_settings; use move_app_data or reset_app_data for app-data operations.',
				inputSchema: appInput,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'get_app_details', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					// Keep resource snapshots sequential, and run the app's disk-usage
					// calculation only after it can no longer distort those readings.
					const memoryUsage = await context.rpc.system.memoryUsage()
					const cpuUsage = await context.rpc.system.cpuUsage()
					const [details, hostname, installed] = await Promise.all([
						context.rpc.apps.details({appId: input.appId}),
						context.rpc.system.getHostname(),
						context.rpc.apps.list(),
					])
					const installedApp = installed.find((app) => app.id === details.id)
					const protocol = details.requiresHttps ? 'https' : 'http'
					const port = details.port ? `:${details.port}` : ''
					const path = details.path ? `/${details.path.replace(/^\/+/, '')}` : ''
					return {
						id: details.id,
						name: details.name,
						version: details.version,
						tagline: details.tagline,
						description: details.description,
						state: details.state,
						progress: details.progress,
						url: `${protocol}://${hostname}.local${port}${path}`,
						credentials: details.credentials,
						dataDirectory: `/Apps/${details.id}`,
						dependents: details.dependents,
						usage: {
							cpu: cpuUsage.apps.find(({id}) => id === details.id)?.used ?? 0,
							memory: memoryUsage.apps.find(({id}) => id === details.id)?.used ?? 0,
							disk: details.diskUsage,
						},
						settings: installedApp ? appSettings(installedApp, installed) : undefined,
					}
				}),
		)
	}

	if (hasAppGrants) {
		server.registerTool(
			'get_app_logs',
			{
				title: 'Get app logs',
				description: 'Get the newest N container log lines for a granted app (default 200, maximum 500).',
				inputSchema: appLogsInput,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'get_app_logs', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					const logs = await context.rpc.apps.logs({appId: input.appId, maxOutputBytes: MAX_LOG_BYTES})
					return {appId: input.appId, ...newestLogs(logs, input.lines)}
				}),
		)

		for (const [name, title, description, operation, destructive, idempotent, openWorld] of [
			['start_app', 'Start app', 'Start a granted app and return immediately.', 'start', false, true, false],
			['stop_app', 'Stop app', 'Stop a granted app and return immediately.', 'stop', false, true, false],
			['restart_app', 'Restart app', 'Restart a granted app and return immediately.', 'restart', false, false, false],
			['update_app', 'Update app', 'Update a granted app and return immediately.', 'update', true, false, true],
		] as const) {
			server.registerTool(
				name,
				{
					title,
					description,
					inputSchema: appInput,
					annotations: {
						readOnlyHint: false,
						destructiveHint: destructive,
						idempotentHint: idempotent,
						openWorldHint: openWorld,
					},
				},
				(input) =>
					runTool(context, name, input, async () => {
						await context.mcp.assertAppAccess(input.appId)
						context.mcp.startAppOperation(input.appId, operation, async () => {
							await runAppOperation(context, input.appId, operation)
						})
						return {accepted: true, appId: input.appId, operation}
					}),
			)
		}

		server.registerTool(
			'uninstall_app',
			{
				title: 'Uninstall app',
				description:
					'Permanently uninstall a granted app and delete its app data. This cannot be recovered from Files Trash. Returns immediately while the operation continues.',
				inputSchema: appInput,
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: false,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'uninstall_app', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					context.mcp.startAppOperation(input.appId, 'uninstall', async () => {
						if (!(await context.rpc.apps.uninstall({appId: input.appId}))) {
							throw new Error(`Failed to uninstall '${input.appId}'`)
						}
					})
					return {accepted: true, appId: input.appId, operation: 'uninstall'}
				}),
		)

		server.registerTool(
			'set_app_settings',
			{
				title: 'Set app settings',
				description:
					'Change any combination of umbrelOS settings for a granted app. Read get_app_details.settings first for current values, folder slots, service names, environment options, and dependency choices. Omitted fields stay unchanged. Each supplied list replaces the current editable settings of that kind; include entries you want to retain, or use [] to reset them. appProxyAuthEnabled=null restores the app default. A dependencies object replaces selections, with omitted dependencies reverting to their default app; changed providers require their own app grant. New or changed folder selections and custom mounts require file access to their source paths; unchanged entries may be retained without additional grants. Storage, environment, and dependency changes can restart the app; authentication and credentials-display changes do not. Settings changes are rejected during app lifecycle operations; wait for the operation to finish before retrying. Success means settings were saved, not that the app is ready; check get_app_status.',
				inputSchema: appInput.extend({
					appProxyAuthEnabled: z
						.boolean()
						.nullable()
						.optional()
						.describe('Enable Umbrel login, disable it, or use null to restore the app default.'),
					hideCredentialsBeforeOpen: z
						.boolean()
						.optional()
						.describe('Whether to hide the default-credentials dialog when opening the app.'),
					folderAccess: z
						.array(
							z.object({
								id: z.string().describe('Folder slot id from get_app_details.settings.storage.folderAccess.'),
								sourcePath: z.string().describe('Files path to use for this slot.'),
							}),
						)
						.optional(),
					customMounts: z
						.array(
							z.object({
								serviceName: z.string().describe('Service name from get_app_details.settings.storage.services.'),
								targetPath: z.string().describe('Absolute path inside the service, for example /media/movies.'),
								sourcePath: z.string().describe('Files path to mount there.'),
								readOnly: z.boolean().default(false),
							}),
						)
						.optional(),
					environment: z
						.array(z.object({name: z.string(), value: z.string()}))
						.optional()
						.describe(
							'Declared environment overrides; see settings.environment.exposed for names, defaults, and allowed values.',
						),
					customEnvironment: z
						.array(z.object({serviceName: z.string(), name: z.string(), value: z.string()}))
						.optional()
						.describe('Custom environment overrides for the app services.'),
					dependencies: z
						.record(z.string(), z.string())
						.optional()
						.describe(
							'Declared dependency IDs mapped to installed app IDs; omitted dependency IDs use their default app.',
						),
				}),
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'set_app_settings', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					const {appId, ...settings} = input
					if (!Object.values(settings).some((value) => value !== undefined)) {
						throw new Error('Provide at least one app setting')
					}
					// Read current settings only when retaining existing access matters.
					// An unrelated auth or environment edit must not depend on storage reads.
					if (settings.folderAccess?.length || settings.customMounts?.length || settings.dependencies !== undefined) {
						const app = (await context.rpc.apps.list()).find((candidate) => candidate.id === appId)
						if (!app) throw new Error(`[app-not-installed] App '${appId}' is not installed`)
						if ('error' in app) throw new Error(app.error)

						if (settings.folderAccess) {
							settings.folderAccess = settings.folderAccess.map((folder) => ({
								id: folder.id.trim(),
								sourcePath: normalizeAppStorageSourcePath(folder.sourcePath),
							}))
							for (const folder of settings.folderAccess) {
								const unchanged = app.storage?.folderAccess.some(
									(current) => current.id === folder.id && current.sourcePath === folder.sourcePath,
								)
								if (!unchanged) await context.mcp.assertFileAccess(folder.sourcePath)
							}
						}
						if (settings.customMounts) {
							settings.customMounts = settings.customMounts.map((mount) => ({
								...mount,
								serviceName: mount.serviceName.trim(),
								targetPath: normalizeAppMountTargetPath(mount.targetPath),
								sourcePath: normalizeAppStorageSourcePath(mount.sourcePath),
							}))
							for (const mount of settings.customMounts) {
								const unchanged = app.storage?.customMounts.some(
									(current) =>
										current.serviceName === mount.serviceName &&
										current.targetPath === mount.targetPath &&
										current.sourcePath === mount.sourcePath &&
										current.readOnly === mount.readOnly,
								)
								if (!unchanged) await context.mcp.assertFileAccess(mount.sourcePath)
							}
						}
						if (settings.dependencies !== undefined) {
							const selected = fillSelectedDependencies(app.dependencies, settings.dependencies)
							for (const [dependencyId, provider] of Object.entries(selected)) {
								if (provider !== app.selectedDependencies[dependencyId]) await context.mcp.assertAppAccess(provider)
							}
						}
					}
					await context.rpc.apps.setSettings({appId, ...settings})
					const {state, progress} = await context.rpc.apps.state({appId})
					return {saved: true, appId, state, progress}
				}),
		)

		server.registerTool(
			'move_app_data',
			{
				title: 'Move app data',
				description:
					"Move a granted app's managed data to a folder on an available ext4 external drive, or back to internal storage with destinationParentPath=null. External destinations require file write access. The app and its dependents may stop and restart. Returns immediately; poll get_app_status until activeOperation is null and check lastOperationFailure.",
				inputSchema: appInput.extend({
					destinationParentPath: z
						.string()
						.nullable()
						.describe('Files path to an external-drive folder, or null for internal storage.'),
				}),
				annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
			},
			(input) =>
				runTool(context, 'move_app_data', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					const destinationParentPath =
						input.destinationParentPath === null
							? null
							: (await context.mcp.assertFileWriteAccess(input.destinationParentPath)).path
					context.mcp.startAppOperation(input.appId, 'move-data', async () => {
						await context.rpc.apps.moveDataRoot({appId: input.appId, destinationParentPath})
					})
					return {accepted: true, appId: input.appId, operation: 'move-data'}
				}),
		)

		server.registerTool(
			'reset_app_data',
			{
				title: 'Reset unavailable app data',
				description:
					"Abandon a granted app's unavailable external data and initialize fresh data on internal storage. Existing internal app data is removed; unavailable external data is left behind and will no longer be used. Only available when the current external app-data location is unavailable. The app and its dependents may stop and restart. Returns immediately; poll get_app_status until activeOperation is null and check lastOperationFailure.",
				inputSchema: appInput,
				annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false},
			},
			(input) =>
				runTool(context, 'reset_app_data', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					context.mcp.startAppOperation(input.appId, 'reset-data', async () => {
						await context.rpc.apps.resetDataRoot({appId: input.appId})
					})
					return {accepted: true, appId: input.appId, operation: 'reset-data'}
				}),
		)
	}

	if (permissions.appStore) {
		server.registerTool(
			'search_app_store',
			{
				title: 'Search the App Store',
				description: 'Search the current public umbrelOS App Store registry by app ID, name, tagline, or description.',
				inputSchema: z.object({
					query: z.string().default('').describe('Search text. Use an empty string to browse.'),
					limit: z.number().int().min(1).max(50).default(20),
				}),
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				},
			},
			(input) =>
				runTool(context, 'search_app_store', input, async () => {
					await context.mcp.assertAppStoreAccess()
					const query = input.query.trim().toLocaleLowerCase()
					const installed = await installedAppIds(context)
					return (await registryApps(context))
						.filter((app) =>
							[app.id, app.name, app.tagline, app.description].some((value) =>
								value?.toLocaleLowerCase().includes(query),
							),
						)
						.slice(0, input.limit)
						.map((app) => ({
							id: app.id,
							name: app.name,
							tagline: app.tagline,
							version: app.version,
							category: app.category,
							compatible: app.compatible,
							dependencies: app.dependencies ?? [],
							installed: installed.has(app.id),
						}))
				}),
		)

		server.registerTool(
			'get_app_store_details',
			{
				title: 'Get App Store app details',
				description:
					'Get the full description, install size, release notes, and dependencies for an App Store app before installing it.',
				inputSchema: z.object({
					appId: appIdSchema.describe('The App Store app ID.'),
				}),
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				},
			},
			(input) =>
				runTool(context, 'get_app_store_details', input, async () => {
					await context.mcp.assertAppStoreAccess()
					const [apps, installed] = await Promise.all([registryApps(context), installedAppIds(context)])
					const app = apps.find((app) => app.id === input.appId)
					if (!app) throw new Error(`[app-not-found] App '${input.appId}' is not in the App Store`)
					return {
						id: app.id,
						name: app.name,
						version: app.version,
						tagline: app.tagline,
						description: app.description,
						category: app.category,
						compatible: app.compatible,
						dependencies: app.dependencies ?? [],
						implements: app.implements ?? [],
						installSize: app.installSize,
						releaseNotes: app.releaseNotes,
						installed: installed.has(input.appId),
					}
				}),
		)

		server.registerTool(
			'install_app',
			{
				title: 'Install app',
				description: `Install an App Store app and grant it to MCP, returning immediately while the operation continues. Call get_app_store_details first to review what the app does and its install size. Ensure its dependencies are installed first. The optional alternatives map a dependency ID to the installed app satisfying it (for example, bitcoin to bitcoin-knots). Installation failures surface through get_app_status. ${installReadyNote}`,
				inputSchema: z.object({
					appId: appIdSchema.describe('The App Store app ID to install.'),
					alternatives: z
						.record(z.string(), z.string())
						.optional()
						.describe('Dependency IDs mapped to installed apps that implement them.'),
				}),
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: false,
					openWorldHint: true,
				},
			},
			(input) =>
				runTool(context, 'install_app', input, async () => {
					await context.mcp.assertAppStoreAccess()
					context.mcp.startAppOperation(input.appId, 'install', async () => {
						if (!(await context.rpc.apps.install({appId: input.appId, alternatives: input.alternatives}))) {
							throw new Error(`Failed to install '${input.appId}'`)
						}
						await context.mcp.addAppGrant(input.appId)
					})
					return {accepted: true, appId: input.appId, operation: 'install', note: installReadyNote}
				}),
		)
	}
}
