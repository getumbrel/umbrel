import os from 'node:os'
import {TRPCError} from '@trpc/server'
import {z} from 'zod'
import type {ProgressStatus} from '../../../apps/schema.js'
import {factoryResetDemoState, startReset} from '../../../factory-reset.js'
import {getCpuTemperature, getDiskUsage, getMemoryUsage, reboot, shutdown} from '../../../system.js'
import {sleep} from '../../../utilities/sleep.js'
import {privateProcedure, publicProcedure, router} from '../trpc.js'

type Device = 'umbrel-home' | 'raspberry-pi' | 'linux'

export default router({
	uptime: privateProcedure.query(() => {
		return os.uptime()
	}),
	// TODO: have consistent naming for these
	osVersion: privateProcedure.query(() => {
		// TODO: do this for real
		return '1.0.0'
	}),
	getLatestVersion: privateProcedure.query(async () => {
		// TODO: do this for real
		await sleep(1000)
		return '1.0.1'
	}),
	updateOs: privateProcedure.mutation(async () => {
		// TODO: do this for real
		await sleep(1000)
		return '1.0.1'
	}),
	//
	deviceInfo: privateProcedure.query(() => ({
		// Maybe rename `device` to `container` or `osContainer`?
		device: 'umbrel-home' as Device,
		modelNumber: 'U130121',
		serialNumber: 'U230300078',
	})),
	//
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld.dataDirectory)),
	memoryUsage: privateProcedure.query(() => getMemoryUsage()),
	shutdown: privateProcedure.mutation(() => shutdown()),
	reboot: privateProcedure.mutation(() => reboot()),
	//
	factoryReset: privateProcedure
		.input(
			z.object({
				password: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			if (!(await ctx.user.validatePassword(input.password))) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid password'})
			}

			const currentInstall = ctx.umbreld.dataDirectory
			startReset(currentInstall)
			return factoryResetDemoState
		}),
	// Public because we delete the user too and want to continue to get status updates
	getFactoryResetStatus: publicProcedure.query((): ProgressStatus | undefined => {
		return factoryResetDemoState
	}),
})
