import os from 'node:os'

import fse from 'fs-extra'
import {TRPCError} from '@trpc/server'
import {z} from 'zod'
import systeminfo from 'systeminformation'
import fetch from 'node-fetch'
import {$} from 'execa'

import type {ProgressStatus} from '../../../apps/schema.js'
import {factoryResetDemoState, startReset} from '../../../factory-reset.js'
import {
	getCpuTemperature,
	getDiskUsage,
	getMemoryUsage,
	getCpuUsage,
	reboot,
	shutdown,
	detectDevice,
} from '../../../system.js'

import {privateProcedure, publicProcedure, router} from '../trpc.js'

type SystemStatus = {
	status: 'running' | 'updating'
	/** From 0 to 100 */
	progress: number
	description: string
	error: boolean | string
}

let systemStatus: SystemStatus = {
	status: 'running',
	progress: 0,
	description: '',
	error: false,
}

function updateSystemStatus(properties: Partial<SystemStatus>) {
	systemStatus = {...systemStatus, ...properties}
}

export default router({
	online: publicProcedure.query(() => true),
	status: privateProcedure.query(() => systemStatus),
	uptime: privateProcedure.query(() => os.uptime()),
	version: privateProcedure.query(({ctx}) => ctx.umbreld.version),
	latestAvailableVersion: privateProcedure.query(async ({ctx}) => {
		const result = await fetch('https://api.umbrel.com/latest-release', {
			headers: {'User-Agent': `umbrelOS ${ctx.umbreld.version}`},
		})
		const data = await result.json()
		return (data as any).version as string
	}),
	update: privateProcedure.mutation(async () => {
		updateSystemStatus({status: 'updating', progress: 10, description: 'Updating...'})
		// TODO: Fetch update script from API
		const updateScript = `#!/usr/bin/env bash
		echo umbrel-update: '{"percent": 0, "message": "Downloading update"}'

		mender install http://lukes-pro.local:8000/build/umbrelos-pi.mender

		echo umbrel-update: '{"percent": 100, "message": "Download complete"}'`

		const process = $`bash -c ${updateScript}`

		for await (const chunk of process.stdout!) {
			const text = chunk.toString()
			const lines = text.split('\n')
			for (const line of lines) {
				if (line.startsWith('umbrel-update: ')) {
					const status = JSON.parse(line.replace('umbrel-update: ', '')) as Partial<SystemStatus>
					updateSystemStatus(status)
				}
			}
		}

		await process
		return '1.0.1'
	}),
	//
	device: privateProcedure.query(() => detectDevice()),
	//
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld)),
	memoryUsage: privateProcedure.query(({ctx}) => getMemoryUsage(ctx.umbreld)),
	cpuUsage: privateProcedure.query(({ctx}) => getCpuUsage(ctx.umbreld)),
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
