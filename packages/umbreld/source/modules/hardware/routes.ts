import {z} from 'zod'

import {router, privateProcedure, publicProcedureWhenNoUserExists} from '../server/trpc/trpc.js'

const internalStorage = router({
	// Get internal storage devices (NVMe, HDD, eMMC, etc.)
	getDevices: publicProcedureWhenNoUserExists.query(async ({ctx}) => ctx.umbreld.hardware.internalStorage.getDevices()),
})

const raid = router({
	// Setup RAID array from a list of devices
	// TOOD: Remove this, just exposing for development and testing.
	setup: privateProcedure
		.input(z.object({devices: z.array(z.string())}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.setup(input.devices)),

	// Add a device to an existing RAID array
	addDevice: privateProcedure
		.input(z.object({device: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.raid.addDevice(input.device)),
})

const umbrelPro = router({
	// Check if running on Umbrel Pro hardware
	isUmbrelPro: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.umbrelPro.isUmbrelPro()),

	// TODO: Don't expose these routes, they are only for debugging.

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
