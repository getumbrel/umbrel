import os from 'node:os'
import fse from 'fs-extra'
import {TRPCError} from '@trpc/server'
import {z} from 'zod'
import systeminfo from 'systeminformation'
import type {ProgressStatus} from '../../../apps/schema.js'
import {factoryResetDemoState, startReset} from '../../../factory-reset.js'
import {getCpuTemperature, getDiskUsage, getMemoryUsage, reboot, shutdown} from '../../../system.js'
import {sleep} from '../../../utilities/sleep.js'
import {privateProcedure, publicProcedure, router} from '../trpc.js'

export default router({
	uptime: privateProcedure.query(() => {
		return os.uptime()
	}),
	// TODO: have consistent naming for these
	version: privateProcedure.query(() => {
		// TODO: do this for real
		return '1.0.0'
	}),
	latestAvailableVersion: privateProcedure.query(async () => {
		// TODO: do this for real
		await sleep(1000)
		return '1.0.1'
	}),
	update: privateProcedure.mutation(async () => {
		// TODO: do this for real
		await sleep(1000)
		return '1.0.1'
	}),
	//
	device: privateProcedure.query(async () => {
		// This file exists in old versions of amd64 Umbrel OS builds due to the Docker build system.
		// It confuses the systeminfo library and makes it return the model as 'Docker Container'.
		// TODO: Remove this once we've done a full fs upgrade
		await fse.remove('/.dockerenv')

		const {manufacturer, model, serial, uuid, sku} = await systeminfo.system()

		// TODO: Allow these to be overidden by env vars or cli flags
		return {manufacturer, model, serial, uuid, sku}
	}),
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
