import type {CallToolResult, McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod4'

import {
	MACHINE_INPUT_ACTIONS,
	MAX_LONG_PRESS_SECONDS,
	MAX_SCROLL_AMOUNT,
	MAX_TYPE_TEXT_LENGTH,
	MAX_WAIT_SECONDS,
	MIN_LONG_PRESS_SECONDS,
	SCREENSHOT_MAX_EDGE,
	type MachineScreenshot,
} from '../../machines/machine-control.js'
import {machineIdPattern, MACHINE_ID_MAX_LENGTH} from '../../machines/machine-id.js'
import type {McpPermissions} from '../mcp.js'
import {runTool, runToolResult, type McpToolContext} from './shared.js'

// Mirrors the canonical validation in machine-id.ts
const machineIdSchema = z.string().max(MACHINE_ID_MAX_LENGTH).regex(machineIdPattern)
const machineInput = z.object({machineId: machineIdSchema.describe('The machine ID.')})
const screenshotCoordinate = z
	.tuple([z.number().int().min(0), z.number().int().min(0)])
	.describe('[x, y] pixel position in the most recent screenshot, origin top-left.')

type Machine = Awaited<ReturnType<McpToolContext['rpc']['machines']['list']>>[number]

// Compact summaries: enough to pick a machine and follow its lifecycle
function machineSummary(machine: Machine) {
	return {
		id: machine.id,
		name: machine.name,
		os: {id: machine.osId, name: machine.osName, version: machine.osVersion, variant: machine.osVariant},
		arch: machine.arch,
		state: machine.state,
		...(machine.installationState ? {installationState: machine.installationState} : {}),
		...(machine.installProgress !== undefined ? {installProgress: machine.installProgress} : {}),
		...(machine.errorMessage ? {error: machine.errorMessage} : {}),
		firstBootSetup: machine.firstBootSetup,
		cores: machine.cores,
		memoryGb: machine.memoryGb,
		diskSizeGb: machine.diskSizeGb,
		storageUsedGb: machine.storageUsedGb,
		acceleration: machine.acceleration,
	}
}

async function findMachine(context: McpToolContext, machineId: string) {
	const machine = (await context.rpc.machines.list()).find(({id}) => id === machineId)
	if (!machine) throw new Error(`[machine-not-found] Machine '${machineId}' does not exist`)
	return machine
}

function screenshotResult(text: Record<string, unknown>, screenshot: MachineScreenshot): CallToolResult {
	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{...text, screenshot: {width: screenshot.width, height: screenshot.height, mimeType: screenshot.mimeType}},
					null,
					2,
				),
			},
			{type: 'image', data: screenshot.data, mimeType: screenshot.mimeType},
		],
	}
}

const coordinateNote = `Coordinates are [x, y] pixels in the most recent screenshot, origin top-left. Screenshots are scaled to at most ${SCREENSHOT_MAX_EDGE} px on the long edge and every result states its width and height, so always take coordinates from the latest screenshot.`

export default function registerMachineTools(server: McpServer, context: McpToolContext, permissions: McpPermissions) {
	server.registerTool(
		'list_machines',
		{
			title: 'List machines',
			description:
				'List the virtual machines on this umbrelOS device with their OS, state, installation progress, resources, and errors.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'list_machines', input, async () => (await context.rpc.machines.list()).map(machineSummary)),
	)

	const hasMachineGrants = permissions.machines === 'all' || permissions.machines.length > 0

	if (hasMachineGrants) {
		server.registerTool(
			'get_machine_details',
			{
				title: 'Get machine details',
				description:
					'Get the full configuration of a granted machine: network address, username, port forwards, disk location, autostart, firmware, and live CPU and memory usage.',
				inputSchema: machineInput,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'get_machine_details', input, async () => {
					await context.mcp.assertMachineAccess(input.machineId)
					const machine = await findMachine(context, input.machineId)
					// Keep resource snapshots sequential so the collectors never overlap
					const memoryUsage = await context.rpc.system.memoryUsage()
					const cpuUsage = await context.rpc.system.cpuUsage()
					return {
						...machineSummary(machine),
						ipAddress: machine.ipAddress,
						username: machine.username,
						portForwards: machine.portForwards,
						autostart: machine.autostart,
						platformProfile: machine.platformProfile,
						firmware: machine.firmware,
						diskBus: machine.diskBus,
						diskPath: machine.diskPath,
						installationMediaAttached: machine.installationMediaAttached,
						performanceWarning: machine.performanceWarning,
						createdAt: machine.createdAt,
						usage: {
							cpu: cpuUsage.machines.find(({id}) => id === machine.id)?.used ?? 0,
							memory: memoryUsage.machines.find(({id}) => id === machine.id)?.used ?? 0,
						},
					}
				}),
		)

		for (const [name, title, description, operation, destructive, idempotent] of [
			['start_machine', 'Start machine', 'Start a granted machine.', 'start', false, true],
			[
				'stop_machine',
				'Stop machine',
				'Ask a granted machine to shut down gracefully. If this times out, the guest is refusing the power button: a desktop session with a logged-in user often does. Take a screenshot and shut it down from inside instead, for example with a terminal command that ignores inhibitors, before resorting to force_stop_machine.',
				'stop',
				false,
				true,
			],
			['restart_machine', 'Restart machine', 'Restart a granted machine.', 'restart', false, false],
			[
				'force_stop_machine',
				'Force stop machine',
				'Cut power to a granted machine immediately from any state. Unsaved work inside the guest is lost; prefer stop_machine.',
				'forceStop',
				true,
				true,
			],
			[
				'retry_machine_install',
				'Retry machine install',
				'Retry a failed or interrupted installation of a granted machine.',
				'retryInstall',
				false,
				false,
			],
			[
				'eject_machine_install_media',
				'Eject machine install media',
				'Detach the installer media from a granted machine after a manual installation has finished, so it boots from its disk.',
				'ejectInstallMedia',
				false,
				true,
			],
		] as const) {
			server.registerTool(
				name,
				{
					title,
					description,
					inputSchema: machineInput,
					annotations: {
						readOnlyHint: false,
						destructiveHint: destructive,
						idempotentHint: idempotent,
						openWorldHint: operation === 'retryInstall',
					},
				},
				(input) =>
					runTool(context, name, input, async () => {
						await context.mcp.assertMachineAccess(input.machineId)
						await context.rpc.machines[operation]({id: input.machineId})
						return {operation, ...machineSummary(await findMachine(context, input.machineId))}
					}),
			)
		}

		server.registerTool(
			'update_machine_settings',
			{
				title: 'Update machine settings',
				description:
					'Change the name, CPU cores, memory, disk size (grow only), autostart, or port forwards of a granted machine. Resource changes take effect on the next start.',
				inputSchema: machineInput.extend({
					name: z.string().min(1).max(100).optional(),
					cores: z.number().int().min(1).max(64).optional(),
					memoryGb: z.number().int().min(1).max(1_024).optional(),
					diskSizeGb: z.number().int().min(1).max(10_000).optional().describe('Grow only; shrinking is rejected.'),
					autostart: z.boolean().optional().describe('Start the machine when umbrelOS boots.'),
					portForwards: z
						.array(
							z.object({
								id: z.string().min(1).describe('Any stable identifier for the rule.'),
								protocol: z.enum(['tcp', 'udp']),
								hostPort: z.number().int().min(1).max(65_535),
								guestPort: z.number().int().min(1).max(65_535),
							}),
						)
						.optional()
						.describe('The complete list of port forwards; omitted rules are removed.'),
				}),
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'update_machine_settings', input, async () => {
					await context.mcp.assertMachineAccess(input.machineId)
					const {machineId, ...settings} = input
					const machine = await context.rpc.machines.updateSettings({id: machineId, ...settings})
					return {...machineSummary(machine), autostart: machine.autostart, portForwards: machine.portForwards}
				}),
		)

		server.registerTool(
			'delete_machine',
			{
				title: 'Delete machine',
				description:
					'Permanently delete a granted machine and its virtual disk. A running machine is forced off first. This cannot be undone or recovered from Files Trash.',
				inputSchema: machineInput,
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: false,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'delete_machine', input, async () => {
					await context.mcp.assertMachineAccess(input.machineId)
					if (!(await context.rpc.machines.uninstall({id: input.machineId}))) {
						throw new Error(`Failed to delete '${input.machineId}'`)
					}
					return {deleted: true, machineId: input.machineId}
				}),
		)

		server.registerTool(
			'get_machine_screenshot',
			{
				title: 'Get machine screenshot',
				description: `Capture the screen of a running granted machine as a JPEG. Use it to see the current state of the guest before acting with control_machine. ${coordinateNote}`,
				inputSchema: machineInput,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runToolResult(context, 'get_machine_screenshot', input, async () => {
					await context.mcp.assertMachineAccess(input.machineId)
					const screenshot = await context.machines.screenshot(input.machineId, {agent: context.agent})
					return screenshotResult({machineId: input.machineId}, screenshot)
				}),
		)

		server.registerTool(
			'control_machine',
			{
				title: 'Control machine',
				description: `Use the keyboard and mouse of a running granted machine like a person at its console. Every call performs one action and returns a screenshot taken about a second later. Always inspect that screenshot before the next action: popups, pickers, and dialogs can take the keyboard focus, and anything typed into them is lost. ${coordinateNote} Actions: mouse_move (coordinate); left_click, right_click, middle_click, double_click, triple_click (coordinate; optional text names modifier keys to hold such as "shift" or "ctrl+alt"); long_press (coordinate, duration in seconds, default 1); left_click_drag (startCoordinate to coordinate, pausing at the destination so window managers register edge actions); scroll (coordinate, scrollDirection, scrollAmount in wheel clicks); key (text is an xdotool-style combination such as "ctrl+alt+Delete", "Return", "alt+F4", or "super"; separate combinations with spaces to press them in sequence); type (text is typed literally, newlines press Return; coordinate is required and is the field the text goes into: the pointer glides there before typing without clicking or changing focus, so the field must already have focus; omit coordinate only on machines without a pointer); wait (duration in seconds, for a screen that is still changing). The pointer glides to each target from where it was last left. Typing assumes a US keyboard layout in the guest. Android machines see this pointer as a mouse rather than a finger: right_click opens what a long touch would, double_click selects text rather than zooming, file managers and similar lists open items on double_click rather than a single click, the wheel scrolls lists, Escape acts as Back, a stuck on-screen keyboard closes with Escape or a tap elsewhere, and there is no multi-touch. Windows 98 and other legacy machines have no absolute pointing device and accept keyboard actions only; omit coordinate when typing on them.`,
				inputSchema: machineInput.extend({
					action: z.enum(MACHINE_INPUT_ACTIONS),
					coordinate: screenshotCoordinate.optional(),
					startCoordinate: screenshotCoordinate.optional().describe('Where a left_click_drag begins.'),
					text: z
						.string()
						.max(MAX_TYPE_TEXT_LENGTH)
						.optional()
						.describe('Text to type, the key combination to press, or modifier keys to hold during a click.'),
					scrollDirection: z.enum(['up', 'down', 'left', 'right']).optional(),
					scrollAmount: z
						.number()
						.int()
						.min(1)
						.max(MAX_SCROLL_AMOUNT)
						.optional()
						.describe('Wheel clicks to scroll (default 3).'),
					duration: z
						.number()
						.min(0)
						.max(MAX_WAIT_SECONDS)
						.optional()
						.describe(
							`Seconds to wait (default 1), or to hold a long_press (default 1, ${MIN_LONG_PRESS_SECONDS} to ${MAX_LONG_PRESS_SECONDS}).`,
						),
				}),
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: false,
					openWorldHint: false,
				},
			},
			(input) =>
				runToolResult(context, 'control_machine', input, async () => {
					await context.mcp.assertMachineAccess(input.machineId)
					const {machineId, ...action} = input
					const screenshot = await context.machines.control(machineId, action, {agent: context.agent})
					return screenshotResult({machineId, action: action.action}, screenshot)
				}),
		)
	}

	if (permissions.createMachines) {
		server.registerTool(
			'list_os_images',
			{
				title: 'List machine OS images',
				description:
					'List the operating systems a new machine can be created from, with download size, architecture, whether credentials or a license key are needed, and download state, plus what this host can virtualize.',
				inputSchema: z.object({}),
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				},
			},
			(input) =>
				runTool(context, 'list_os_images', input, async () => {
					await context.mcp.assertMachineCreateAccess()
					const [images, capabilities] = await Promise.all([
						context.rpc.machines.osImages(),
						context.rpc.machines.capabilities(),
					])
					return {
						host: {
							architecture: capabilities.hostArchitecture,
							virtualizationAvailable: capabilities.libvirtAvailable,
							acceleration: capabilities.nativeAcceleration,
							...(capabilities.performanceWarning ? {performanceWarning: capabilities.performanceWarning} : {}),
						},
						images: images.map((image) => ({
							id: image.id,
							name: image.variantName ? `${image.name} ${image.variantName}` : image.name,
							version: image.version,
							arch: image.arch,
							platform: image.platform,
							sizeMb: image.sizeMb,
							estimatedInstalledSizeMb: image.estimatedInstalledSizeMb,
							requiresCredentials: image.requiresCredentials,
							requiresLicenseKey: image.requiresLicenseKey ?? false,
							manualSetup: image.manualSetup ?? false,
							evaluation: image.evaluation ?? false,
							state: image.state,
							...(image.downloadProgress !== undefined ? {downloadProgress: image.downloadProgress} : {}),
							...(image.errorMessage ? {error: image.errorMessage} : {}),
						})),
					}
				}),
		)

		server.registerTool(
			'create_machine',
			{
				title: 'Create machine',
				description:
					'Create a new virtual machine from an OS image (osId from list_os_images) or a custom ISO or disk image on this device (imagePath) and grant it to MCP. Returns immediately while the image downloads and installs in the background; follow list_machines. Images that require credentials need username and password, which set up the OS account during installation and are never stored, so share them with the user. Pick cores and memory that leave headroom for the host, and an image matching the host architecture unless slow emulation is acceptable.',
				inputSchema: z
					.object({
						name: z.string().min(1).max(100),
						osId: z.string().optional().describe('An image ID from list_os_images.'),
						imagePath: z
							.string()
							.optional()
							.describe('A granted file path to a custom .iso or disk image, for example /Home/images/custom.iso.'),
						diskSizeGb: z.number().int().min(1).max(10_000),
						cores: z.number().int().min(1).max(64),
						memoryGb: z.number().int().min(1).max(1_024),
						arch: z.enum(['amd64', 'arm64']).optional().describe('Defaults to the host architecture.'),
						platformProfile: z
							.enum(['modern-x86', 'windows-7-x86', 'legacy-x86', 'windows-98-x86', 'modern-arm64'])
							.optional()
							.describe('Custom images only; catalog images carry their own.'),
						firmware: z.enum(['uefi', 'bios']).optional().describe('Custom images only.'),
						diskBus: z.enum(['virtio', 'sata']).optional().describe('Custom images only.'),
						diskDirectory: z
							.string()
							.optional()
							.describe('Custom images only: a granted /External or /Network folder to keep the virtual disk in.'),
						username: z.string().min(1).max(32).optional(),
						password: z.string().min(1).max(128).optional(),
						licenseKey: z
							.string()
							.regex(/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/i)
							.optional()
							.describe('Required by Windows XP and Windows 98 images only.'),
					})
					.refine((input) => !!input.osId !== !!input.imagePath, {message: 'Provide exactly one of osId or imagePath'}),
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: false,
					openWorldHint: true,
				},
			},
			(input) =>
				runTool(context, 'create_machine', input, async () => {
					await context.mcp.assertMachineCreateAccess()
					// Custom sources read and write through the file grants, exactly as
					// the file tools would
					if (input.imagePath) await context.mcp.assertFileAccess(input.imagePath)
					if (input.diskDirectory) await context.mcp.assertFileWriteAccess(input.diskDirectory)
					const machine = await context.rpc.machines.create(input)
					await context.mcp.addMachineGrant(machine.id)
					return {
						...machineSummary(machine),
						note: 'Installation continues in the background. Follow list_machines until state is running and firstBootSetup is false, then use get_machine_details for its address.',
					}
				}),
		)
	}
}
