import z from 'zod'

import {router, privateProcedure} from '../server/trpc/trpc.js'
import {MACHINE_INPUT_ACTIONS, MAX_SCROLL_AMOUNT, MAX_TYPE_TEXT_LENGTH, MAX_WAIT_SECONDS} from './machine-control.js'
import {machineIdSchema} from './machine-id.js'

const windowsLicenseKey = z.string().regex(/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/i)
const screenshotCoordinate = z.tuple([z.number().int().min(0), z.number().int().min(0)])

export default router({
	capabilities: privateProcedure.query(async ({ctx}) => ctx.umbreld.machines.capabilities()),

	// List all machines
	list: privateProcedure.query(async ({ctx}) => ctx.umbreld.machines.list()),

	// Create a machine immediately, then download/prepare/start it in the
	// background. The returned machine is already visible in the installing
	// state and progress is streamed via the machines event.
	create: privateProcedure
		.input(
			z
				.object({
					name: z.string().min(1).max(100),
					osId: z.string().optional(),
					imagePath: z.string().optional(),
					diskSizeGb: z.number().int().min(1).max(10_000),
					cores: z.number().int().min(1).max(64),
					memoryGb: z.number().int().min(1).max(1_024),
					arch: z.enum(['amd64', 'arm64']).optional(),
					platformProfile: z
						.enum(['modern-x86', 'windows-7-x86', 'legacy-x86', 'windows-98-x86', 'modern-arm64'])
						.optional(),
					firmware: z.enum(['uefi', 'bios']).optional(),
					diskBus: z.enum(['virtio', 'sata']).optional(),
					diskDirectory: z.string().min(1).optional(),
					username: z.string().min(1).max(32).optional(),
					// Only used during OS setup — never part of the machine definition
					password: z.string().min(1).max(128).optional(),
					// XP/98 keys are install-time secrets. Machines consumes this value
					// directly while preparing private media and never persists it.
					licenseKey: windowsLicenseKey.optional(),
				})
				.refine((input) => !!input.osId !== !!input.imagePath, {
					message: 'Provide exactly one of osId or imagePath',
				}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.create(input)),

	retryInstall: privateProcedure
		.input(z.object({id: machineIdSchema}))
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.retryInstall(input.id)),

	start: privateProcedure
		.input(z.object({id: machineIdSchema}))
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.startMachine(input.id)),

	stop: privateProcedure
		.input(z.object({id: machineIdSchema}))
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.stopMachine(input.id)),

	restart: privateProcedure
		.input(z.object({id: machineIdSchema}))
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.restartMachine(input.id)),

	// Immediately stop a machine from any non-stopped state (escape hatch for
	// machines stuck starting/stopping/restarting/installing/error)
	forceStop: privateProcedure
		.input(z.object({id: machineIdSchema}))
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.forceStopMachine(input.id)),

	// Permanently deletes the machine and its virtual disk. Allowed in any
	// state: running machines are force-stopped, installing machines have
	// their install cancelled.
	uninstall: privateProcedure
		.input(z.object({id: machineIdSchema}))
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.uninstall(input.id)),

	updateSettings: privateProcedure
		.input(
			z.object({
				id: machineIdSchema,
				name: z.string().min(1).max(100).optional(),
				cores: z.number().int().min(1).max(64).optional(),
				memoryGb: z.number().int().min(1).max(1_024).optional(),
				firmware: z.enum(['uefi', 'bios']).optional(),
				diskBus: z.enum(['virtio', 'sata']).optional(),
				// Grow-only: shrinking below the current size is rejected
				diskSizeGb: z.number().int().min(1).max(10_000).optional(),
				autostart: z.boolean().optional(),
				portForwards: z
					.array(
						z.object({
							id: z.string().min(1),
							protocol: z.enum(['tcp', 'udp']),
							hostPort: z.number().int().min(1).max(65_535),
							guestPort: z.number().int().min(1).max(65_535),
						}),
					)
					.optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const {id, ...settings} = input
			return ctx.umbreld.machines.updateSettings(id, settings)
		}),

	setPinned: privateProcedure
		.input(z.object({id: machineIdSchema, pinned: z.boolean()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.setPinned(input.id, input.pinned)),

	ejectInstallMedia: privateProcedure
		.input(z.object({id: machineIdSchema}))
		.mutation(async ({ctx, input}) => ctx.umbreld.machines.ejectInstallMedia(input.id)),

	// The OS picker starts downloads only as an internal phase of machine
	// creation. Cache state is intentionally not user-managed.
	osImages: privateProcedure.query(async ({ctx}) => ctx.umbreld.machines.listOsImages()),

	// Which machines an MCP agent is currently driving, so the console can show
	// who is at the controls
	agentControls: privateProcedure.query(async ({ctx}) => ctx.umbreld.machines.agentControls()),

	// The console as a still image, scaled for machine vision. Coordinates
	// given to control refer to this image's pixels.
	screenshot: privateProcedure
		.input(z.object({id: machineIdSchema}))
		.query(async ({ctx, input}) => ctx.umbreld.machines.screenshot(input.id)),

	// One keyboard or pointer action at the console, answered with the screen
	// after it took effect
	control: privateProcedure
		.input(
			z.object({
				id: machineIdSchema,
				action: z.enum(MACHINE_INPUT_ACTIONS),
				coordinate: screenshotCoordinate.optional(),
				startCoordinate: screenshotCoordinate.optional(),
				text: z.string().max(MAX_TYPE_TEXT_LENGTH).optional(),
				scrollDirection: z.enum(['up', 'down', 'left', 'right']).optional(),
				scrollAmount: z.number().int().min(1).max(MAX_SCROLL_AMOUNT).optional(),
				duration: z.number().min(0).max(MAX_WAIT_SECONDS).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const {id, ...action} = input
			return ctx.umbreld.machines.control(id, action)
		}),
})
