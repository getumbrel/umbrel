import {setTimeout as delay} from 'node:timers/promises'

import type {McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod4'

import {MAX_LOG_BYTES, newestLogs, runTool, type McpToolContext} from './shared.ts'

export default function registerSystemManagementTools(server: McpServer, context: McpToolContext) {
	server.registerTool(
		'install_os_update',
		{
			title: 'Install OS update',
			description:
				'Install the currently available umbrelOS update in the background and auto-restart the device when it succeeds. Pass the manifestHash check_os_update returned to install only the update it showed.',
			inputSchema: z.object({
				manifestHash: z
					.string()
					.regex(/^[0-9a-f]{64}$/)
					.optional()
					.describe('The manifestHash check_os_update returned, so only the update it showed installs'),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		(input) =>
			runTool(context, 'install_os_update', input, async () => {
				await context.mcp.assertSystemAccess()
				if ((await context.rpc.update.status()).running) throw new Error('[update-in-progress]')

				void delay(1_000)
					.then(() => context.rpc.update.install({manifestHash: input.manifestHash}))
					.catch((error) => context.mcp.logger.error('Background OS update failed', error))
				return {accepted: true, operation: 'install-os-update'}
			}),
	)

	server.registerTool(
		'get_os_update_status',
		{
			title: 'Get OS update status',
			description: 'Get progress and error information for the current or most recent umbrelOS update.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'get_os_update_status', input, async () => {
				await context.mcp.assertSystemAccess()
				return context.rpc.update.status()
			}),
	)

	server.registerTool(
		'restart_device',
		{
			title: 'Restart device',
			description: 'Restart the umbrelOS device after returning an acknowledgement.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'restart_device', input, async () => {
				await context.mcp.assertSystemAccess()
				void delay(1000)
					.then(() => context.rpc.system.restart())
					.catch((error) => context.mcp.logger.error('Device restart failed', error))
				return {accepted: true, operation: 'restart-device'}
			}),
	)

	server.registerTool(
		'set_hostname',
		{
			title: 'Set device hostname',
			description: 'Set the local hostname used by this umbrelOS device and its .local address.',
			inputSchema: z.object({
				hostname: z
					.string()
					.trim()
					.toLowerCase()
					.regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Invalid hostname'),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'set_hostname', input, async () => {
				await context.mcp.assertSystemAccess()
				return {hostname: await context.rpc.system.setHostname({hostname: input.hostname})}
			}),
	)

	server.registerTool(
		'set_release_channel',
		{
			title: 'Toggle umbrelOS Beta Program enrollment by setting the release channel',
			description: 'Choose the stable or beta umbrelOS update channel.',
			inputSchema: z.object({channel: z.enum(['stable', 'beta'])}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'set_release_channel', input, async () => {
				await context.mcp.assertSystemAccess()
				await context.rpc.update.setReleaseChannel({channel: input.channel})
				return {channel: input.channel}
			}),
	)

	server.registerTool(
		'get_network_settings',
		{
			title: 'Get network settings',
			description:
				'Get physical network interfaces, the connected Wi-Fi network, and the external DNS preference for this device.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'get_network_settings', input, async () => {
				await context.mcp.assertSystemAccess()
				const [interfaces, wifi, externalDns] = await Promise.all([
					context.rpc.system.getNetworkInterfaces(),
					context.rpc.wifi.connected().catch(() => ({status: 'disconnected' as const})),
					context.rpc.system.isExternalDns(),
				])
				return {interfaces, wifi, externalDns}
			}),
	)

	server.registerTool(
		'get_system_logs',
		{
			title: 'Get system logs',
			description:
				'Get the newest N ANSI-stripped journal lines for umbrelOS services or the full system (default 200, maximum 1,500).',
			inputSchema: z.object({
				type: z.enum(['umbrelos', 'system']),
				lines: z
					.number()
					.int()
					.min(1)
					.overwrite((lines) => Math.min(lines, 1500))
					.max(1500)
					.default(200)
					.describe('Number of newest log lines to return (default 200, maximum 1,500).'),
			}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'get_system_logs', input, async () => {
				await context.mcp.assertSystemAccess()
				const logs = await context.rpc.system.logs({
					type: input.type,
					lines: input.lines,
					maxOutputBytes: MAX_LOG_BYTES,
				})
				return newestLogs(logs, input.lines)
			}),
	)
}
