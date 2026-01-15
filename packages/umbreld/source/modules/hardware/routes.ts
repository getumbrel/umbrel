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

	// Get RAID pool status
	getStatus: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.raid.getStatus()),

	// Setup RAID array from a list of devices
	// TOOD: Remove this, just exposing for development and testing.
	setup: privateProcedure
		.input(z.object({devices: z.array(z.string()), raidType: z.enum(['storage', 'failsafe'])}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.setup(input.devices, input.raidType)),

	// Add a device to an existing RAID array
	addDevice: privateProcedure
		.input(z.object({device: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.addDevice(input.device)),

	// Transition a single-disk storage array to a failsafe (raidz1) array
	transitionToFailsafe: privateProcedure
		.input(z.object({device: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.transitionToFailsafe(input.device)),
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
