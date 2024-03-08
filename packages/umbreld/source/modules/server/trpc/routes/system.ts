import os from 'node:os'

import {TRPCError} from '@trpc/server'
import {z} from 'zod'
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
	status: 'running' | 'updating' | 'shutting-down' | 'restarting'
	/** From 0 to 100 */
	progress: number
	description: string
	error: boolean | string
}

function resetSystemStatus() {
	systemStatus = {
		status: 'running',
		progress: 0,
		description: '',
		error: false,
	}
}

let systemStatus: SystemStatus
resetSystemStatus()

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
	update: privateProcedure.mutation(async ({ctx}) => {
		updateSystemStatus({status: 'updating', progress: 10, description: 'Updating...', error: false})
		// TODO: Fetch update script from API
		const updateScript = `#!/usr/bin/env bash
		set -euo pipefail
		echo umbrel-update: '{"progress": 0, "message": "Downloading update"}'

		if ! command -v mender &> /dev/null
		then
			echo umbrel-update: '{"error": "Mender not installed"}'
			exit 1
		fi

		mender install http://lukes-pro.local:8000/build/umbrelos-pi.mender

		echo umbrel-update: '{"progress": 100, "message": "Download complete"}'`

		// Exectute update script and report progress
		const process = $`bash -c ${updateScript}`
		let menderInstallDots = 0
		async function handleUpdateScriptOutput(chunk: Buffer) {
			const text = chunk.toString()
			const lines = text.split('\n')
			for (const line of lines) {
				// Handle our custom status updates
				if (line.startsWith('umbrel-update: ')) {
					try {
						const status = JSON.parse(line.replace('umbrel-update: ', '')) as Partial<SystemStatus>
						updateSystemStatus(status)
					} catch (error) {
						// Don't kill update on JSON parse errors
					}
				}

				// Handle mender install progress
				if (line === '.') {
					menderInstallDots++
					// Mender install will stream 70 dots to stdout, lets convert that into 5%-95% of install progress
					const progress = Math.min(95, Math.floor((menderInstallDots / 70) * 90) + 5)
					updateSystemStatus({progress})
				}
			}
		}
		process.stdout?.on('data', (chunk) => handleUpdateScriptOutput(chunk))
		process.stderr?.on('data', (chunk) => handleUpdateScriptOutput(chunk))

		// Wait for script to complete and handle errors
		try {
			await process
		} catch (error) {
			// Don't overwrite a useful error message reported by the update script
			if (!systemStatus.error) updateSystemStatus({error: 'Update failed'})

			// Reset the state back to running but leave the error message so ui polls
			// can differentiate between a successful update after reboot and a failed
			// update that didn't reboot.
			const errorStatus = systemStatus.error
			resetSystemStatus()
			updateSystemStatus({error: errorStatus})

			ctx.umbreld.logger.error(`Update script failed: ${(error as Error).message}`)

			return false
		}

		updateSystemStatus({progress: 95})

		await ctx.umbreld.stop()
		await reboot()

		return true
	}),
	//
	device: privateProcedure.query(() => detectDevice()),
	//
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld)),
	memoryUsage: privateProcedure.query(({ctx}) => getMemoryUsage(ctx.umbreld)),
	cpuUsage: privateProcedure.query(({ctx}) => getCpuUsage(ctx.umbreld)),
	shutdown: privateProcedure.mutation(async ({ctx}) => {
		updateSystemStatus({status: 'shutting-down', progress: 0, description: 'Shutting down...', error: false})
		await ctx.umbreld.stop()
		await shutdown()
	}),
	restart: privateProcedure.mutation(async ({ctx}) => {
		updateSystemStatus({status: 'restarting', progress: 0, description: 'Restarting...', error: false})
		await ctx.umbreld.stop()
		await reboot()
	}),
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
