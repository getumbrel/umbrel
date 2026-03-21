import {z} from 'zod'

import {router, privateProcedure, publicProcedureWhenNoUserExists, publicProcedure} from '../server/trpc/trpc.js'

const internalStorage = router({
	// Get internal storage devices (NVMe, HDD, eMMC, etc.)
	getDevices: publicProcedureWhenNoUserExists.query(async ({ctx}) => ctx.umbreld.hardware.internalStorage.getDevices()),
})

const raid = router({
	// Check status of initial RAID setup boot process
	checkInitialRaidSetupStatus: publicProcedure.query(async ({ctx}) =>
		ctx.umbreld.hardware.raid.checkInitialRaidSetupStatus(),
	),

	// Check if RAID mount failed during boot
	checkRaidMountFailure: publicProcedure.query(async ({ctx}) => ctx.umbreld.hardware.raid.checkRaidMountFailure()),

	// Get details about why RAID mount failed
	checkRaidMountFailureDevices: publicProcedureWhenNoUserExists.query(async ({ctx}) =>
		ctx.umbreld.hardware.raid.checkRaidMountFailureDevices(),
	),

	// Get RAID pool status
	getStatus: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.raid.getStatus()),

	// Setup RAID array from a list of devices
	// TOOD: Remove this, just exposing for development and testing.
	setup: privateProcedure
		.input(
			z.object({
				devices: z.array(z.string()),
				raidType: z.enum(['storage', 'failsafe']),
				acceleratorDevices: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.hardware.raid.setup(input.devices, input.raidType, input.acceleratorDevices),
		),

	// Add a single device to an existing RAID array.
	// Allowed for storage mode and failsafe raidz mode.
	addDevice: privateProcedure
		.input(z.object({deviceId: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.addDevice(input.deviceId)),

	// Add a mirror pair to an HDD failsafe array.
	// This endpoint only applies when current topology is mirror.
	addMirror: privateProcedure
		.input(z.object({deviceIds: z.tuple([z.string(), z.string()])}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.addMirror(input.deviceIds)),

	// Add accelerator SSDs to an HDD RAID array.
	addAccelerator: privateProcedure
		.input(z.object({deviceIds: z.array(z.string()).min(1).max(2)}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.addAccelerator(input.deviceIds)),

	// Replace a device in an existing RAID array
	replaceDevice: privateProcedure
		.input(z.object({oldDevice: z.string(), newDevice: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.replaceDevice(input.oldDevice, input.newDevice)),

	// Transition an SSD storage array to failsafe (raidz) mode
	transitionToFailsafeRaidz: privateProcedure
		.input(z.object({newDeviceId: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.transitionToFailsafeRaidz(input.newDeviceId)),

	// Transition an HDD storage array to failsafe (mirror) mode
	// Each existing storage device must be paired with a new mirror device.
	// If a single accelerator already exists, acceleratorDeviceId supplies the SSD used to mirror it.
	transitionToFailsafeMirror: privateProcedure
		.input(
			z.object({
				pairs: z.array(z.object({existingDeviceId: z.string(), newDeviceId: z.string()})).min(1),
				acceleratorDeviceId: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.hardware.raid.transitionToFailsafeMirror(input.pairs, input.acceleratorDeviceId),
		),
})

const umbrelPro = router({
	// Check if running on Umbrel Pro hardware
	isUmbrelPro: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.umbrelPro.isUmbrelPro()),

	// TODO: These are exposed in factory builds for hardware testing. Remove when we have a better solution.

	// LED control
	setLedOff: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.hardware.umbrelPro.setLedOff()),
	setLedStatic: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.hardware.umbrelPro.setLedStatic()),
	setLedDefault: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.hardware.umbrelPro.setLedDefault()),
	setLedColor: privateProcedure
		.input(z.object({red: z.number(), green: z.number(), blue: z.number()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.umbrelPro.setLedColor(input)),
	setLedWhite: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.hardware.umbrelPro.setLedWhite()),
	setLedBlinking: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.hardware.umbrelPro.setLedBlinking()),
	setLedBreathe: privateProcedure
		.input(z.object({duration: z.number().optional()}).optional())
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.umbrelPro.setLedBreathe(input?.duration)),

	// Fan control
	setFanManagementEnabled: privateProcedure
		.input(z.object({enabled: z.boolean()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.umbrelPro.setFanManagementEnabled(input.enabled)),
	setMinFanSpeed: privateProcedure
		.input(z.object({percent: z.number()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.umbrelPro.setMinFanSpeed(input.percent)),

	// Reset boot flag
	wasBootedViaResetButton: privateProcedure.query(async ({ctx}) =>
		ctx.umbreld.hardware.umbrelPro.wasBootedViaResetButton(),
	),
	clearResetBootFlag: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.hardware.umbrelPro.clearResetBootFlag()),
})

export default router({
	internalStorage,
	raid,
	umbrelPro,
})
