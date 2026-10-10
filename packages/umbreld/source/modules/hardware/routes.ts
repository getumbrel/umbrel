import {z} from 'zod'

import {router, privateProcedure, publicProcedureWhenNoUserExists, publicProcedure} from '../server/trpc/trpc.js'
import {getGpuInfo} from './gpu.js'

const internalStorage = router({
	// Get internal storage devices (NVMe, HDD, eMMC, etc.)
	getDevices: publicProcedureWhenNoUserExists.query(async ({ctx}) => ctx.umbreld.hardware.internalStorage.getDevices()),
})

const gpu = router({
	// Report the graphics controllers currently available.
	getInfo: privateProcedure.query(async () => getGpuInfo()),
})

const thunderbolt = router({
	// Only the device owner can inspect or change Thunderbolt authorization.
	getDevices: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.thunderbolt.getDevices()),
	getPendingDevices: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.thunderbolt.getPendingDevices()),
	authorize: privateProcedure
		.input(z.object({id: z.string().uuid()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.thunderbolt.authorize(input.id)),
	revoke: privateProcedure
		.input(z.object({id: z.string().uuid()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.thunderbolt.revoke(input.id)),
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

	// Check whether a previous Umbrel RAID install can be recovered during onboarding
	hasRecoverableInstall: publicProcedureWhenNoUserExists.query(async ({ctx}) =>
		ctx.umbreld.hardware.raid.hasRecoverableInstall(),
	),

	// Recover a previous Umbrel RAID install during onboarding
	recoverExistingInstall: publicProcedureWhenNoUserExists.mutation(async ({ctx}) =>
		ctx.umbreld.hardware.raid.recoverExistingInstall(),
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

	// Manually scrub the RAID pool
	scrub: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.hardware.raid.scrub()),

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

const mdadm = router({
	// Whether the mdadm binary is available on this host
	isSupported: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.mdadm.isSupported()),

	// Full mdadm array inventory (parsed from /proc/mdstat + mdadm --detail)
	getStatus: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.mdadm.getStatus()),

	// Raw `mdadm --detail` output for one array
	detail: privateProcedure
		.input(z.object({device: z.string().regex(/^\/dev\/md\d+$/)}))
		.query(async ({ctx, input}) => ctx.umbreld.hardware.mdadm.detail(input.device)),

	// Create a new array. Without `device`, the first free /dev/mdN is allocated (multi-array).
	create: privateProcedure
		.input(
			z.object({
				level: z.enum(['0', '1', '5', '6', '10']),
				devices: z.array(z.string()).min(2).max(32),
				name: z.string().min(1).max(32).optional(),
				chunk: z.number().int().positive().optional(),
				assumeClean: z.boolean().optional(),
				device: z.string().regex(/^\/dev\/md\d+$/).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.mdadm.create(input)),

	// Hot-add a spare/device to an array
	addDevice: privateProcedure
		.input(z.object({arrayDevice: z.string().regex(/^\/dev\/md\d+$/), device: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.mdadm.add(input.arrayDevice, input.device)),

	// Remove a member (must be failed or spare)
	removeDevice: privateProcedure
		.input(z.object({arrayDevice: z.string().regex(/^\/dev\/md\d+$/), device: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.mdadm.remove(input.arrayDevice, input.device)),

	// Mark a member faulty
	failDevice: privateProcedure
		.input(z.object({arrayDevice: z.string().regex(/^\/dev\/md\d+$/), device: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.mdadm.fail(input.arrayDevice, input.device)),

	// Stop an array
	stop: privateProcedure
		.input(z.object({arrayDevice: z.string().regex(/^\/dev\/md\d+$/)}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.mdadm.stop(input.arrayDevice)),

	// Assemble all arrays found in mdadm.conf / superblocks
	assembleScan: privateProcedure
		.input(z.object({run: z.boolean().optional()}).optional())
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.mdadm.assembleScan({run: input?.run ?? false})),

	// Next free /dev/mdN for the create dialog
	allocateDevice: privateProcedure.query(async ({ctx}) => ctx.umbreld.hardware.mdadm.allocateDevice()),

	// Grow / reshape: expand RAID5/6, migrate level, or use max size after disk replacement
	grow: privateProcedure
		.input(
			z.object({
				arrayDevice: z.string().regex(/^\/dev\/md\d+$/),
				raidDevices: z.number().int().positive().optional(),
				level: z.enum(['0', '1', '5', '6', '10']).optional(),
				backupFile: z.string().optional(),
				sizeMax: z.boolean().optional(),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.hardware.mdadm.grow(input.arrayDevice, {
				raidDevices: input.raidDevices,
				level: input.level,
				backupFile: input.backupFile,
				sizeMax: input.sizeMax,
			}),
		),

	// Hot-add spares then expand the array in one call (RAID5/6 growth)
	growAddAndExpand: privateProcedure
		.input(
			z.object({
				arrayDevice: z.string().regex(/^\/dev\/md\d+$/),
				devices: z.array(z.string()).min(1).max(8),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.hardware.mdadm.growAddAndExpand(input.arrayDevice, input.devices),
		),

	// Use full capacity after replacing members with larger disks
	growToMaxSize: privateProcedure
		.input(z.object({arrayDevice: z.string().regex(/^\/dev\/md\d+$/)}))
		.mutation(async ({ctx, input}) => ctx.umbreld.hardware.mdadm.growToMaxSize(input.arrayDevice)),
})

export default router({
	internalStorage,
	gpu,
	thunderbolt,
	raid,
	mdadm,
	umbrelPro,
})
