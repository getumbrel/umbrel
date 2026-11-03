import type {McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod4'

import {runTool, type McpToolContext} from './shared.ts'

export default function registerSystemInfoTools(server: McpServer, context: McpToolContext) {
	server.registerTool(
		'get_system_info',
		{
			title: 'Get system information',
			description:
				'Get this umbrelOS device model, hardware specifications, hostname, IP addresses, version, status, umbrelOS Beta Program status (release channel), and uptime.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'get_system_info', input, async () => {
				const [specs, version, status, releaseChannel, hostname, ipAddresses, uptimeSeconds] = await Promise.all([
					context.rpc.systemNg.device.getSpecs(),
					context.rpc.system.version(),
					context.rpc.system.status(),
					context.rpc.update.getReleaseChannel(),
					context.rpc.system.getHostname(),
					context.rpc.system.getIpAddresses(),
					context.rpc.system.uptime(),
				])
				return {
					version: version.version,
					versionName: version.name,
					status,
					releaseChannel,
					hostname,
					ipAddresses,
					uptimeSeconds,
					// Specs are picked field by field, never spread: this tool needs no
					// granted permission, so the hardware serial and SMBIOS UUID that
					// getSpecs() also returns must never reach the agent.
					deviceId: specs.deviceId,
					device: specs.device,
					productName: specs.productName,
					manufacturer: specs.manufacturer,
					model: specs.model,
					cpu: specs.cpu,
					memorySize: specs.memorySize,
					memoryType: specs.memoryType,
					storageSize: specs.storageSize,
					storageType: specs.storageType,
				}
			}),
	)

	server.registerTool(
		'get_system_resources',
		{
			title: 'Get system resources',
			description:
				'Get current CPU, memory, and storage usage, CPU temperature, plus RAID or storage-pool health when present, for this umbrelOS device. CPU and memory include per-app and per-machine breakdowns.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'get_system_resources', input, async () => {
				// Measure temperature before the collectors can heat the CPU, then keep
				// memory and CPU sequential so their Docker and top work never overlaps.
				// Unsupported hardware has no sensor, so temperature remains optional.
				const temperature = await context.rpc.system.cpuTemperature().catch(() => undefined)
				const memory = await context.rpc.system.memoryUsage()
				const cpu = await context.rpc.system.cpuUsage()
				const [storage, raid] = await Promise.all([
					context.rpc.system.systemDiskUsage(),
					context.rpc.hardware.raid.getStatus(),
				])
				const storageHealth = raid.exists
					? {
							status: raid.status,
							degraded: raid.status === 'DEGRADED',
							...(raid.rebuild ? {rebuild: raid.rebuild} : {}),
							...(raid.replace ? {replace: raid.replace} : {}),
							devices: raid.devices?.map(({id, status, readErrors, writeErrors, checksumErrors}) => ({
								id,
								status,
								readErrors,
								writeErrors,
								checksumErrors,
							})),
						}
					: undefined
				return {cpu, memory, storage, temperature, ...(storageHealth ? {storageHealth} : {})}
			}),
	)

	server.registerTool(
		'check_os_update',
		{
			title: 'Check for an OS update',
			description: "Check whether a newer umbrelOS update is available and return its release notes (what's new).",
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		(input) => runTool(context, 'check_os_update', input, () => context.rpc.update.check()),
	)

	server.registerTool(
		'get_notifications',
		{
			title: 'Get notifications',
			description: 'Get the current backend notification (IDs only) for the Umbrel owner.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) => runTool(context, 'get_notifications', input, () => context.rpc.notifications.get()),
	)
}
