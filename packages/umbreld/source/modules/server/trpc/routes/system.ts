import os from 'node:os'

import {TRPCError} from '@trpc/server'
import {z} from 'zod'
import fetch from 'node-fetch'
import {$} from 'execa'
import fse from 'fs-extra'

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

type SystemStatus = 'running' | 'updating' | 'shutting-down' | 'restarting'
let systemStatus: SystemStatus = 'running'

type UpdateStatus = {
	running: boolean
	/** From 0 to 100 */
	progress: number
	description: string
	error: boolean | string
}

function resetUpdateStatus() {
	updateStatus = {
		running: false,
		progress: 0,
		description: '',
		error: false,
	}
}

let updateStatus: UpdateStatus
resetUpdateStatus()

function setUpdateStatus(properties: Partial<UpdateStatus>) {
	updateStatus = {...updateStatus, ...properties}
}

export default router({
	online: publicProcedure.query(() => true),
	version: publicProcedure.query(({ctx}) => ctx.umbreld.version),
	status: publicProcedure.query(() => systemStatus),
	updateStatus: privateProcedure.query(() => updateStatus),
	uptime: privateProcedure.query(() => os.uptime()),
	latestAvailableVersion: privateProcedure.query(async ({ctx}) => {
		const result = await fetch('https://api.umbrel.com/latest-release', {
			headers: {'User-Agent': `umbrelOS ${ctx.umbreld.version}`},
		})
		const data = await result.json()
		return (data as any).version as string
	}),
	update: privateProcedure.mutation(async ({ctx}) => {
		systemStatus = 'updating'
		setUpdateStatus({running: true, progress: 5, description: 'Updating...', error: false})
		// TODO: Fetch update script from API
		const updateScript = `#!/usr/bin/env bash
		set -euo pipefail

		update_url=""

		if ! command -v mender &> /dev/null
		then
			echo umbrel-update: '{"error": "Mender not installed"}'
			exit 1
		fi

		if cat /var/lib/mender/device_type | grep --quiet 'device_type=raspberrypi'
		then
			update_url="https://umbrel.nyc3.digitaloceanspaces.com/dev/umbrelos-pi.update"
		fi

		if cat /var/lib/mender/device_type | grep --silent 'device_type=amd64'
		then
			update_url="https://umbrel.nyc3.digitaloceanspaces.com/dev/umbrelos-amd64.update"
		fi

		mender install "\${update_url}"`

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
						const status = JSON.parse(line.replace('umbrel-update: ', '')) as Partial<UpdateStatus>
						setUpdateStatus(status)
					} catch (error) {
						// Don't kill update on JSON parse errors
					}
				}

				// Handle mender install progress
				if (line === '.') {
					menderInstallDots++
					// Mender install will stream 70 dots to stdout, lets convert that into 5%-95% of install progress
					const progress = Math.min(95, Math.floor((menderInstallDots / 70) * 90) + 5)
					setUpdateStatus({progress})
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
			if (!updateStatus.error) setUpdateStatus({error: 'Update failed'})

			// Reset the state back to running but leave the error message so ui polls
			// can differentiate between a successful update after reboot and a failed
			// update that didn't reboot.
			const errorStatus = updateStatus.error
			resetUpdateStatus()
			setUpdateStatus({error: errorStatus})
			systemStatus = 'running'

			ctx.umbreld.logger.error(`Update script failed: ${(error as Error).message}`)

			return false
		}

		setUpdateStatus({progress: 95})

		await ctx.umbreld.stop()
		await reboot()

		return true
	}),
	hiddenService: privateProcedure.query(async ({ctx}) => {
		try {
			return await fse.readFile(`${ctx.umbreld.dataDirectory}/tor/data/web/hostname`, 'utf-8')
		} catch (error) {
			ctx.umbreld.logger.error(`Failed to read hidden service for ui: ${(error as Error).message}`)
			return ''
		}
	}),
	device: privateProcedure.query(() => detectDevice()),
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld)),
	memoryUsage: privateProcedure.query(({ctx}) => getMemoryUsage(ctx.umbreld)),
	cpuUsage: privateProcedure.query(({ctx}) => getCpuUsage(ctx.umbreld)),
	shutdown: privateProcedure.mutation(async ({ctx}) => {
		systemStatus = 'shutting-down'
		await ctx.umbreld.stop()
		await shutdown()

		return true
	}),
	restart: privateProcedure.mutation(async ({ctx}) => {
		systemStatus = 'restarting'
		await ctx.umbreld.stop()
		await reboot()

		return true
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
